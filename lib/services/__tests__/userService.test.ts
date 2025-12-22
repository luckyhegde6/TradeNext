// Mock Prisma before importing the service
jest.mock('../../prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import { getAllUsers, getPaginatedUsers, getUserById, createUser } from '../userService';
import prisma from '../../prisma';

// Get the mocked prisma instance
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('User Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllUsers', () => {
    test('should return all users', async () => {
      const mockUsers = [
        { id: 1, name: 'John Doe', email: 'john@example.com', createdAt: new Date() },
        { id: 2, name: 'Jane Doe', email: 'jane@example.com', createdAt: new Date() },
      ];

      mockPrisma.user.findMany.mockResolvedValue(mockUsers);

      const result = await getAllUsers();

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
      });
      expect(result).toEqual(mockUsers);
    });

    test('should handle database errors', async () => {
      mockPrisma.user.findMany.mockRejectedValue(new Error('Database error'));

      await expect(getAllUsers()).rejects.toThrow('Database error');
    });
  });

  describe('getPaginatedUsers', () => {
    test('should return paginated users', async () => {
      const mockUsers = [
        { id: 1, name: 'John Doe', email: 'john@example.com', createdAt: new Date() },
      ];
      const mockTotal = 25;

      mockPrisma.user.findMany.mockResolvedValue(mockUsers);
      mockPrisma.user.count.mockResolvedValue(mockTotal);

      const result = await getPaginatedUsers(2, 10);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
        skip: 10, // (page - 1) * limit = (2 - 1) * 10
        take: 10,
      });
      expect(mockPrisma.user.count).toHaveBeenCalled();

      expect(result).toEqual({
        users: mockUsers,
        total: mockTotal,
        totalPages: 3, // Math.ceil(25 / 10)
      });
    });

    test('should use default values for page and limit', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await getPaginatedUsers();

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0, // (1 - 1) * 20
          take: 20,
        })
      );
    });
  });

  describe('getUserById', () => {
    test('should return user by id', async () => {
      const mockUser = { id: 1, name: 'John Doe', email: 'john@example.com', createdAt: new Date() };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await getUserById(1);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
      });
      expect(result).toEqual(mockUser);
    });

    test('should return null for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await getUserById(999);

      expect(result).toBeNull();
    });
  });

  describe('createUser', () => {
    test('should create a new user', async () => {
      const userData = { name: 'John Doe', email: 'john@example.com', password: 'password123' };
      const mockCreatedUser = {
        id: 1,
        ...userData,
        createdAt: new Date()
      };

      mockPrisma.user.create.mockResolvedValue(mockCreatedUser);

      const result = await createUser(userData);

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: userData,
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
      });
      expect(result).toEqual(mockCreatedUser);
    });

    test('should handle optional fields', async () => {
      const userData = { email: 'john@example.com' }; // No name or password
      const mockCreatedUser = {
        id: 1,
        name: null,
        email: 'john@example.com',
        createdAt: new Date()
      };

      mockPrisma.user.create.mockResolvedValue(mockCreatedUser);

      const result = await createUser(userData);

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: userData,
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
      });
      expect(result).toEqual(mockCreatedUser);
    });
  });
});
