import type { MemoryQuery, QueryType } from './types.js';

export type SortField = NonNullable<MemoryQuery['sortField']>;
export type SortDirection = NonNullable<MemoryQuery['sortDirection']>;

/**
 * Fluent builder for MemoryQuery objects.
 *
 * @example
 * const q = query()
 *   .semantic('authentication patterns')
 *   .inNamespace('security')
 *   .withTags(['critical'])
 *   .threshold(0.8)
 *   .limit(10)
 *   .build();
 */
export class QueryBuilder {
  private _type: QueryType = 'hybrid';
  private _content?: string;
  private _namespace?: string;
  private _tags?: string[];
  private _limit = 10;
  private _offset?: number;
  private _threshold?: number;
  private _sortField?: SortField;
  private _sortDirection?: SortDirection;

  semantic(content: string): this {
    this._type = 'semantic';
    this._content = content;
    return this;
  }

  exact(key: string): this {
    this._type = 'exact';
    this._content = key;
    return this;
  }

  hybrid(content: string): this {
    this._type = 'hybrid';
    this._content = content;
    return this;
  }

  inNamespace(namespace: string): this {
    this._namespace = namespace;
    return this;
  }

  withTags(tags: string[]): this {
    this._tags = tags;
    return this;
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  offset(n: number): this {
    this._offset = n;
    return this;
  }

  threshold(t: number): this {
    this._threshold = t;
    return this;
  }

  sortBy(field: SortField, direction: SortDirection = 'desc'): this {
    this._sortField = field;
    // Only store direction when it differs from the default ('desc')
    this._sortDirection = direction === 'desc' ? undefined : direction;
    return this;
  }

  newestFirst(): this { return this.sortBy('createdAt', 'desc'); }
  oldestFirst(): this { return this.sortBy('createdAt', 'asc'); }
  recentlyAccessed(): this { return this.sortBy('lastAccessedAt', 'desc'); }
  mostAccessed(): this { return this.sortBy('accessCount', 'desc'); }

  reset(): this {
    this._type = 'hybrid';
    this._content = undefined;
    this._namespace = undefined;
    this._tags = undefined;
    this._limit = 10;
    this._offset = undefined;
    this._threshold = undefined;
    this._sortField = undefined;
    this._sortDirection = undefined;
    return this;
  }

  clone(): QueryBuilder {
    const b = new QueryBuilder();
    b._type = this._type;
    b._content = this._content;
    b._namespace = this._namespace;
    b._tags = this._tags ? [...this._tags] : undefined;
    b._limit = this._limit;
    b._offset = this._offset;
    b._threshold = this._threshold;
    b._sortField = this._sortField;
    b._sortDirection = this._sortDirection;
    return b;
  }

  build(): MemoryQuery {
    const q: MemoryQuery = {
      type: this._type,
      limit: this._limit,
    };
    if (this._content !== undefined) q.content = this._content;
    if (this._namespace !== undefined) q.namespace = this._namespace;
    if (this._tags !== undefined) q.tags = this._tags;
    if (this._offset !== undefined) q.offset = this._offset;
    if (this._threshold !== undefined) q.threshold = this._threshold;
    if (this._sortField !== undefined) q.sortField = this._sortField;
    if (this._sortDirection !== undefined) q.sortDirection = this._sortDirection;
    return q;
  }
}

/** Factory shorthand: `query().semantic('...').build()` */
export function query(): QueryBuilder {
  return new QueryBuilder();
}

/** Pre-built common query patterns */
export const QueryTemplates = {
  recentInNamespace(namespace: string, limit = 10): MemoryQuery {
    return query().hybrid('').inNamespace(namespace).limit(limit).newestFirst().build();
  },

  byTags(tags: string[], limit = 10): MemoryQuery {
    return query().hybrid('').withTags(tags).limit(limit).build();
  },

  semanticSearch(content: string, limit = 10, threshold = 0.7): MemoryQuery {
    return query().semantic(content).limit(limit).threshold(threshold).build();
  },

  exactKey(namespace: string, key: string): MemoryQuery {
    return { type: 'exact', key, namespace, limit: 1 };
  },
};
