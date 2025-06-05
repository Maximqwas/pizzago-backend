const request = require('supertest');
const app = require('./app');
const prisma = require('./prisma.js');
const redisClient = require('./redis_client.js');

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

        const res = await request(app).get('/api/v1/pizzas');

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

        const res = await request(app).get('/api/v1/pizzas?tags=vegetarian');

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

        const res = await request(app).get('/api/v1/pizzas?limit=1&page=2');

        expect(res.statusCode).toBe(200);
        expect(res.body.limit).toBe(1);
        expect(res.body.offset).toBe(2);
        expect(res.body.results.length).toBe(1);
    });

    it('should return 400 for invalid limit', async () => {
        const res = await request(app).get('/api/v1/pizzas?limit=200');
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/Limit must be between 0 and 100/);
    });

    it('should handle empty results', async () => {
        prisma.pizza.findMany.mockResolvedValue([]);
        prisma.pizza.count.mockResolvedValue(0);

        const res = await request(app).get('/api/v1/pizzas?tags=nonexistent');

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

            const res = await request(app).get('/api/v1/pizzas/5');

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

            const res = await request(app).get('/api/v1/pizzas/999');

            expect(res.statusCode).toBe(404);
            expect(res.body.error).toMatch(/Pizza not found/);
        });

        it('should return 400 for invalid pizza id', async () => {
            const res = await request(app).get('/api/v1/pizzas/abc');

            expect(res.statusCode).toBe(400);
            expect(res.body.error).toMatch(/Invalid pizza ID/);
        });

    });
});

// --- CART ROUTES TESTS ---

// Mock redis
jest.mock('./redis_client.js', () => {
    return {
        set: jest.fn(),
        get: jest.fn(),
        del: jest.fn(),
        connect: jest.fn(),
    };
});

describe('Cart routes', () => {
    let mockSession;
    let mockSessionId;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSessionId = 'mock-session-id';
        mockSession = {
            id: mockSessionId,
            createdAt: new Date(),
            updatedAt: new Date(),
            cart: {
                items: [],
                total: 0
            }
        };
        // By default, getSessionForRequest will create a new session
        redisClient.get.mockResolvedValue(null);
        redisClient.set.mockResolvedValue();
    });

    describe('GET /cart', () => {
        it('should return an empty cart for a new session', async () => {
            redisClient.set.mockResolvedValue();
            const res = await request(app).get('/api/v1/cart');
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ items: [], total: 0 });
        });

        it('should return an existing cart if session exists', async () => {
            mockSession.cart.items = [{ pizzaId: 1, quantity: 2 }];
            mockSession.cart.total = 20;
            redisClient.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            const agent = request.agent(app);
            // Simulate cookie
            const res = await agent.get('/api/v1/cart').set('Cookie', [`session=${mockSessionId}`]);
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ items: [{ pizzaId: 1, quantity: 2 }], total: 20 });
        });
    });

    describe('POST /cart', () => {
        it('should add a pizza to the cart', async () => {
            prisma.pizza.findUnique.mockResolvedValue({ id: 1, price: 10 });
            redisClient.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            const res = await request(app)
                .post('/api/v1/cart')
                .send({ pizzaId: 1, quantity: 2 });
            expect(res.statusCode).toBe(200);
            expect(res.body.items).toEqual([{ pizzaId: 1, quantity: 2 }]);
            expect(res.body.total).toBe(20);
            expect(redisClient.set).toHaveBeenCalled();
        });

        it('should increment quantity if pizza already in cart', async () => {
            mockSession.cart.items = [{ pizzaId: 1, quantity: 1 }];
            mockSession.cart.total = 10;
            prisma.pizza.findUnique.mockResolvedValue({ id: 1, price: 10 });
            redisClient.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            const res = await request(app)
                .post('/api/v1/cart')
                .send({ pizzaId: 1, quantity: 3 });
            expect(res.statusCode).toBe(200);
            expect(res.body.items).toEqual([{ pizzaId: 1, quantity: 4 }]);
            expect(res.body.total).toBe(40);
        });

        it('should return 400 for invalid pizzaId or quantity', async () => {
            const res = await request(app)
                .post('/api/v1/cart')
                .send({ pizzaId: 'abc', quantity: 2 });
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toMatch(/Invalid pizza ID or quantity/);
        });

        it('should return 404 if pizza does not exist', async () => {
            prisma.pizza.findUnique.mockResolvedValue(null);
            const res = await request(app)
                .post('/api/v1/cart')
                .send({ pizzaId: 999, quantity: 1 });
            expect(res.statusCode).toBe(404);
            expect(res.body.error).toMatch(/Pizza not found/);
        });
    });

    describe('DELETE /cart/:pizzaId', () => {
        it('should remove a pizza from the cart', async () => {
            mockSession.cart.items = [{ pizzaId: 1, quantity: 2 }];
            mockSession.cart.total = 20;
            prisma.pizza.findUnique.mockResolvedValue({ id: 1, price: 10 });
            redisClient.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            const res = await request(app).delete('/api/v1/cart/1');
            expect(res.statusCode).toBe(200);
            expect(res.body.items).toEqual([]);
            expect(res.body.total).toBe(0);
        });

        it('should return 400 for invalid pizzaId', async () => {
            const res = await request(app).delete('/api/v1/cart/abc');
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toMatch(/Invalid pizza ID/);
        });

        it('should return 404 if pizza not in cart', async () => {
            mockSession.cart.items = [];
            redisClient.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            const res = await request(app).delete('/api/v1/cart/2');
            expect(res.statusCode).toBe(404);
            expect(res.body.error).toMatch(/Pizza not found in cart/);
        });

        it('should return 404 if pizza does not exist in DB', async () => {
            mockSession.cart.items = [{ pizzaId: 3, quantity: 1 }];
            prisma.pizza.findUnique.mockResolvedValue(null);
            redisClient.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            const res = await request(app).delete('/api/v1/cart/3');
            expect(res.statusCode).toBe(404);
            expect(res.body.error).toMatch(/Pizza not found/);
        });
    });

    describe('DELETE /cart', () => {
        it('should clear the cart', async () => {
            mockSession.cart.items = [{ pizzaId: 1, quantity: 2 }];
            mockSession.cart.total = 20;
            redisClient.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            const res = await request(app).delete('/api/v1/cart');
            expect(res.statusCode).toBe(200);
            expect(res.body.items).toEqual([]);
            expect(res.body.total).toBe(0);
        });
    });
});
