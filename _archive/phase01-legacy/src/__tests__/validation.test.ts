import { emailSchema, passwordSchema, nameSchema, paginationSchema } from '@/lib/validation'

describe('Validation Schemas', () => {
  describe('emailSchema', () => {
    it('should validate valid email', () => {
      const result = emailSchema.safeParse('test@example.com')
      expect(result.success).toBe(true)
    })

    it('should reject invalid email', () => {
      const result = emailSchema.safeParse('invalid-email')
      expect(result.success).toBe(false)
    })
  })

  describe('passwordSchema', () => {
    it('should validate password with 8+ characters', () => {
      const result = passwordSchema.safeParse('password123')
      expect(result.success).toBe(true)
    })

    it('should reject password with less than 8 characters', () => {
      const result = passwordSchema.safeParse('pass')
      expect(result.success).toBe(false)
    })
  })

  describe('nameSchema', () => {
    it('should validate name with 2+ characters', () => {
      const result = nameSchema.safeParse('John')
      expect(result.success).toBe(true)
    })

    it('should reject name with less than 2 characters', () => {
      const result = nameSchema.safeParse('J')
      expect(result.success).toBe(false)
    })
  })

  describe('paginationSchema', () => {
    it('should use default values', () => {
      const result = paginationSchema.safeParse({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.page).toBe(1)
        expect(result.data.pageSize).toBe(20)
      }
    })

    it('should validate custom pagination values', () => {
      const result = paginationSchema.safeParse({ page: '2', pageSize: '10' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.page).toBe(2)
        expect(result.data.pageSize).toBe(10)
      }
    })
  })
})
