import fs from 'node:fs/promises';
import path from 'node:path';
import { customAlphabet } from 'nanoid';
import { config } from '../config';

const newId = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 8);

/** 极简 JSON 文件存储：每条记录一个文件 data/<collection>/<id>.json */
export class JsonStore<T extends { id: string; createdAt: string; updatedAt: string }> {
  private dir: string;
  constructor(collection: string) {
    this.dir = path.join(config.dataDir, collection);
  }

  private file(id: string) {
    if (!/^[a-z0-9]{4,32}$/.test(id)) return null;
    return path.join(this.dir, `${id}.json`);
  }

  async get(id: string): Promise<T | null> {
    const f = this.file(id);
    if (!f) return null;
    try {
      return JSON.parse(await fs.readFile(f, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  async list(): Promise<T[]> {
    await fs.mkdir(this.dir, { recursive: true });
    const names = (await fs.readdir(this.dir)).filter((n) => n.endsWith('.json'));
    const items = await Promise.all(names.map((n) => this.get(n.slice(0, -5))));
    return (items.filter(Boolean) as T[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T> {
    await fs.mkdir(this.dir, { recursive: true });
    const now = new Date().toISOString();
    const item = { ...data, id: newId(), createdAt: now, updatedAt: now } as T;
    await this.write(item);
    return item;
  }

  async update(id: string, data: Partial<Omit<T, 'id' | 'createdAt'>>): Promise<T | null> {
    const old = await this.get(id);
    if (!old) return null;
    const item = { ...old, ...data, id, createdAt: old.createdAt, updatedAt: new Date().toISOString() } as T;
    await this.write(item);
    return item;
  }

  async remove(id: string): Promise<boolean> {
    const f = this.file(id);
    if (!f) return false;
    try {
      await fs.unlink(f);
      return true;
    } catch {
      return false;
    }
  }

  private async write(item: T) {
    const f = this.file(item.id)!;
    const tmp = `${f}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(item, null, 2));
    await fs.rename(tmp, f);
  }
}
