const request = require('supertest');
const app = require('./app');
const prisma = require('./prisma.js');

// Mock prisma and its methods
jest.mock('./prisma.js', () => {
    return {
        pizza: {
            findMany: jest.fn(),
            count: jest.fn(),
            findUnique: jest.fn(),
        },
        $queryRawUnsafe: jest.fn(),
    };
});


describe('GET /pizzas', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return all pizzas with default paging', async () => {
        const mockPizzas = [
            {
                id: 1,
                name: 'Margherita',
                tags: [{ name: 'vegetarian' }],
                price: 10,
                description: 'Classic pizza',
            },
            {
                id: 2,
                name: 'Pepperoni',
                tags: [{ name: 'spicy' }],
                price: 12,
                description: 'Pepperoni pizza',
            },
        ];
        prisma.pizza.findMany.mockResolvedValue(mockPizzas);
        prisma.pizza.count.mockResolvedValue(2);

        const res = await request(app).get('/pizzas');

        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(2);
        expect(res.body.limit).toBe(20);
        expect(res.body.offset).toBe(0);
        expect(res.body.results).toEqual([
            {
                id: 1,
                name: 'Margherita',
                tags: ['vegetarian'],
                price: 10,
                description: 'Classic pizza',
            },
            {
                id: 2,
                name: 'Pepperoni',
                tags: ['spicy'],
                price: 12,
                description: 'Pepperoni pizza',
            },
        ]);
    });

    it('should filter pizzas by tags', async () => {
        const mockPizzas = [
            {
                id: 3,
                name: 'Veggie',
                tags: [{ name: 'vegetarian' }, { name: 'healthy' }],
                price: 11,
                description: 'Veggie pizza',
            },
        ];
        prisma.pizza.findMany.mockResolvedValue(mockPizzas);
        prisma.pizza.count.mockResolvedValue(1);

        const res = await request(app).get('/pizzas?tags=vegetarian');

        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(1);
        expect(res.body.results[0].tags).toContain('vegetarian');
    });

    it('should respect limit and page parameters', async () => {
        const mockPizzas = [
            {
                id: 4,
                name: 'Hawaiian',
                tags: [{ name: 'sweet' }],
                price: 13,
                description: 'Pineapple pizza',
            },
        ];
        prisma.pizza.findMany.mockResolvedValue(mockPizzas);
        prisma.pizza.count.mockResolvedValue(10);

        const res = await request(app).get('/pizzas?limit=1&page=2');

        expect(res.statusCode).toBe(200);
        expect(res.body.limit).toBe(1);
        expect(res.body.offset).toBe(2);
        expect(res.body.results.length).toBe(1);
    });

    it('should return 400 for invalid limit', async () => {
        const res = await request(app).get('/pizzas?limit=200');
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/Limit must be between 0 and 100/);
    });

    it('should handle empty results', async () => {
        prisma.pizza.findMany.mockResolvedValue([]);
        prisma.pizza.count.mockResolvedValue(0);

        const res = await request(app).get('/pizzas?tags=nonexistent');

        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(0);
        expect(res.body.results).toEqual([]);
    });

    describe('GET /pizzas/:id', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should return pizza by id', async () => {
            const mockPizza = {
                id: 5,
                name: 'Quattro Formaggi',
                tags: [
                    { tag: { name: 'cheese' } },
                    { tag: { name: 'vegetarian' } }
                ],
                ingredients: 'Cheese blend',
                price: 15,
                description: 'Four cheese pizza',
            };
            prisma.pizza.findUnique.mockResolvedValue(mockPizza);

            const res = await request(app).get('/pizzas/5');

            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({
                id: 5,
                name: 'Quattro Formaggi',
                tags: ['cheese', 'vegetarian'],
                ingredients: 'Cheese blend',
                price: 15,
                description: 'Four cheese pizza',
            });
            expect(prisma.pizza.findUnique).toHaveBeenCalledWith({
                where: { id: 5 },
                include: { tags: { include: { tag: { select: { name: true } } } } }
            });
        });

        it('should return 404 if pizza not found', async () => {
            prisma.pizza.findUnique.mockResolvedValue(null);

            const res = await request(app).get('/pizzas/999');

            expect(res.statusCode).toBe(404);
            expect(res.body.error).toMatch(/Pizza not found/);
        });

        it('should return 400 for invalid pizza id', async () => {
            const res = await request(app).get('/pizzas/abc');

            expect(res.statusCode).toBe(400);
            expect(res.body.error).toMatch(/Invalid pizza ID/);
        });
    });
});