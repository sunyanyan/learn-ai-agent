import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { Tool, ToolParameter, toolAction } from '../base.js';

export class NoteTool extends Tool {
  constructor({
    workspace = './notes',
    autoBackup = true,
    maxNotes = 1000,
    expandable = false,
  } = {}) {
    super({
      name: 'note',
      description: '笔记工具 - 创建、读取、更新、删除结构化笔记，支持任务状态、结论、阻塞项等类型',
      expandable,
    });
    this.workspace = workspace;
    this.autoBackup = autoBackup;
    this.maxNotes = maxNotes;
    this.indexFile = join(workspace, 'notes_index.json');
    this.notesIndex = null;
  }

  async _ensureInit() {
    if (this.notesIndex !== null) return;
    await fs.mkdir(this.workspace, { recursive: true });
    try {
      const raw = await fs.readFile(this.indexFile, 'utf-8');
      this.notesIndex = JSON.parse(raw);
    } catch {
      this.notesIndex = {
        notes: [],
        metadata: { createdAt: new Date().toISOString(), totalNotes: 0 },
      };
      await this._saveIndex();
    }
  }

  async _saveIndex() {
    await fs.writeFile(this.indexFile, JSON.stringify(this.notesIndex, null, 2), 'utf-8');
  }

  _generateNoteId() {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const count = this.notesIndex.notes.length;
    return `note_${ts}_${count}`;
  }

  _getNotePath(noteId) {
    return join(this.workspace, `${noteId}.md`);
  }

  _noteToMarkdown(note) {
    let fm = '---\n';
    fm += `id: ${note.id}\n`;
    fm += `title: ${note.title}\n`;
    fm += `type: ${note.type}\n`;
    if (note.tags && note.tags.length > 0) fm += `tags: ${JSON.stringify(note.tags)}\n`;
    fm += `created_at: ${note.createdAt}\n`;
    fm += `updated_at: ${note.updatedAt}\n`;
    fm += '---\n\n';
    fm += `# ${note.title}\n\n`;
    fm += note.content;
    return fm;
  }

  _markdownToNote(md) {
    const fmMatch = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (!fmMatch) throw new Error('无效的笔记格式：缺少YAML前置元数据');

    const fmText = fmMatch[1];
    const contentStart = fmMatch[0].length;
    const note = {};

    for (const line of fmText.split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key === 'tags') {
        try { note[key] = JSON.parse(value); } catch { note[key] = []; }
      } else {
        note[key] = value;
      }
    }

    const mdContent = md.slice(contentStart).trim();
    const lines = mdContent.split('\n');
    if (lines.length > 0 && lines[0].startsWith('# ')) {
      note.content = lines.slice(1).join('\n').trim();
    } else {
      note.content = mdContent;
    }

    note.metadata = { wordCount: note.content.length, status: 'active' };
    return note;
  }

  async run(parameters) {
    await this._ensureInit();
    if (!this.validateParameters(parameters)) return '❌ 参数验证失败';

    const action = parameters.action;
    const actions = {
      create: () => this._createNote({
        title: parameters.title,
        content: parameters.content,
        noteType: parameters.noteType || 'general',
        tags: parameters.tags,
      }),
      read: () => this._readNote(parameters.noteId),
      update: () => this._updateNote({
        noteId: parameters.noteId,
        title: parameters.title,
        content: parameters.content,
        noteType: parameters.noteType,
        tags: parameters.tags,
      }),
      delete: () => this._deleteNote(parameters.noteId),
      list: () => this._listNotes({ noteType: parameters.noteType, limit: parameters.limit || 10 }),
      search: () => this._searchNotes({ query: parameters.query, limit: parameters.limit || 10 }),
      summary: () => this._getSummary(),
    };

    const fn = actions[action];
    if (!fn) return `❌ 不支持的操作: ${action}`;
    return await fn();
  }

  getParameters() {
    return [
      new ToolParameter({ name: 'action', type: 'string', description: '操作类型: create, read, update, delete, list, search, summary', required: true }),
      new ToolParameter({ name: 'title', type: 'string', description: '笔记标题', required: false }),
      new ToolParameter({ name: 'content', type: 'string', description: '笔记内容', required: false }),
      new ToolParameter({ name: 'noteType', type: 'string', description: '笔记类型: task_state, conclusion, blocker, action, reference, general', required: false, default: 'general' }),
      new ToolParameter({ name: 'tags', type: 'array', description: '标签列表', required: false }),
      new ToolParameter({ name: 'noteId', type: 'string', description: '笔记ID', required: false }),
      new ToolParameter({ name: 'query', type: 'string', description: '搜索关键词', required: false }),
      new ToolParameter({ name: 'limit', type: 'integer', description: '返回结果数量限制', required: false, default: 10 }),
    ];
  }

  async _createNote({ title, content, noteType = 'general', tags = null }) {
    if (!title || !content) return '❌ 创建笔记需要提供 title 和 content';
    if (this.notesIndex.notes.length >= this.maxNotes) return `❌ 笔记数量已达上限 (${this.maxNotes})`;

    const noteId = this._generateNoteId();
    const now = new Date().toISOString();
    const note = {
      id: noteId, title, content, type: noteType,
      tags: Array.isArray(tags) ? tags : [],
      createdAt: now, updatedAt: now,
      metadata: { wordCount: content.length, status: 'active' },
    };

    await fs.writeFile(this._getNotePath(noteId), this._noteToMarkdown(note), 'utf-8');
    this.notesIndex.notes.push({
      id: noteId, title, type: noteType,
      tags: Array.isArray(tags) ? tags : [], createdAt: now,
    });
    this.notesIndex.metadata.totalNotes = this.notesIndex.notes.length;
    await this._saveIndex();

    return `✅ 笔记创建成功\nID: ${noteId}\n标题: ${title}\n类型: ${noteType}`;
  }

  async _readNote(noteId) {
    if (!noteId) return '❌ 读取笔记需要提供 noteId';
    try {
      const md = await fs.readFile(this._getNotePath(noteId), 'utf-8');
      const note = this._markdownToNote(md);
      return this._formatNote(note);
    } catch {
      return `❌ 笔记不存在: ${noteId}`;
    }
  }

  async _updateNote({ noteId, title = null, content = null, noteType = null, tags = null }) {
    if (!noteId) return '❌ 更新笔记需要提供 noteId';
    try {
      const md = await fs.readFile(this._getNotePath(noteId), 'utf-8');
      const note = this._markdownToNote(md);
      if (title) note.title = title;
      if (content) { note.content = content; note.metadata.wordCount = content.length; }
      if (noteType) note.type = noteType;
      if (tags !== null) note.tags = Array.isArray(tags) ? tags : [];
      note.updatedAt = new Date().toISOString();

      await fs.writeFile(this._getNotePath(noteId), this._noteToMarkdown(note), 'utf-8');

      const idx = this.notesIndex.notes.find(n => n.id === noteId);
      if (idx) { idx.title = note.title; idx.type = note.type; idx.tags = note.tags; }
      await this._saveIndex();

      return `✅ 笔记更新成功: ${noteId}`;
    } catch {
      return `❌ 笔记不存在: ${noteId}`;
    }
  }

  async _deleteNote(noteId) {
    if (!noteId) return '❌ 删除笔记需要提供 noteId';
    try {
      await fs.unlink(this._getNotePath(noteId));
      this.notesIndex.notes = this.notesIndex.notes.filter(n => n.id !== noteId);
      this.notesIndex.metadata.totalNotes = this.notesIndex.notes.length;
      await this._saveIndex();
      return `✅ 笔记已删除: ${noteId}`;
    } catch {
      return `❌ 笔记不存在: ${noteId}`;
    }
  }

  async _listNotes({ noteType = null, limit = 10 } = {}) {
    let notes = this.notesIndex.notes;
    if (noteType) notes = notes.filter(n => n.type === noteType);
    notes = notes.slice(0, limit);
    if (notes.length === 0) return '📝 暂无笔记';

    let result = `📝 笔记列表（共 ${notes.length} 条）\n\n`;
    for (const note of notes) {
      result += `• [${note.type}] ${note.title}\n`;
      result += `  ID: ${note.id}\n`;
      if (note.tags && note.tags.length > 0) result += `  标签: ${note.tags.join(', ')}\n`;
      result += `  创建时间: ${note.createdAt}\n\n`;
    }
    return result;
  }

  async _searchNotes({ query, limit = 10 }) {
    if (!query) return '❌ 搜索需要提供 query';
    const qLower = query.toLowerCase();
    const matched = [];

    for (const idx of this.notesIndex.notes) {
      try {
        const md = await fs.readFile(this._getNotePath(idx.id), 'utf-8');
        const note = this._markdownToNote(md);
        const inTitle = (note.title || '').toLowerCase().includes(qLower);
        const inContent = (note.content || '').toLowerCase().includes(qLower);
        const inTags = (note.tags || []).some(t => t.toLowerCase().includes(qLower));
        if (inTitle || inContent || inTags) matched.push(note);
      } catch {
        continue;
      }
    }

    const results = matched.slice(0, limit);
    if (results.length === 0) return `📝 未找到匹配 '${query}' 的笔记`;

    let result = `🔍 搜索结果（共 ${results.length} 条）\n\n`;
    for (const note of results) {
      result += this._formatNote(note, true) + '\n';
    }
    return result;
  }

  _getSummary() {
    const total = this.notesIndex.notes.length;
    const typeCounts = {};
    for (const note of this.notesIndex.notes) {
      typeCounts[note.type] = (typeCounts[note.type] || 0) + 1;
    }
    let result = `📊 笔记摘要\n\n总笔记数: ${total}\n\n按类型统计:\n`;
    for (const [t, c] of Object.entries(typeCounts).sort()) {
      result += `  • ${t}: ${c}\n`;
    }
    return result;
  }

  _formatNote(note, compact = false) {
    if (compact) {
      const preview = note.content.length > 100 ? note.content.slice(0, 100) + '...' : note.content;
      return `[${note.type}] ${note.title}\nID: ${note.id}\n内容: ${preview}`;
    }
    let result = `📝 笔记详情\n\nID: ${note.id}\n标题: ${note.title}\n类型: ${note.type}\n`;
    if (note.tags && note.tags.length > 0) result += `标签: ${note.tags.join(', ')}\n`;
    result += `创建时间: ${note.createdAt}\n更新时间: ${note.updatedAt}\n\n内容:\n${note.content}\n`;
    return result;
  }
}