import type { Pagination } from '@/lib/validation'

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export function toPage<T>(items: T[], total: number, pagination: Pagination): Page<T> {
  return {
    items,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
  }
}

export function skipTake(pagination: Pagination) {
  return { skip: (pagination.page - 1) * pagination.pageSize, take: pagination.pageSize }
}
