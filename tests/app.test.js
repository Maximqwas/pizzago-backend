const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/prisma.js');
const redisClient = require('../src/redis_client.js');
const security = require('../src/security.js');
const { sendEmail } = require('../src/mail.js');

// Mock prisma and its methods
jest.mock('../src/prisma.js', () => {
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
jest.mock('../src/redis_client.js', () => {
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

// Mock security and mail modules
jest.mock('../src/security.js', () => ({
    hashPassword: jest.fn(() => 'hashed-password'),
    verifyPassword: jest.fn(),
    getSecureToken: jest.fn(() => 'secure-token'),
}));
jest.mock('../src/mail.js', () => ({
    sendEmail: jest.fn(),
}));


describe('Auth routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/v1/auth/register', () => {
        it('should return 400 if email or password is missing', async () => {
            let res = await request(app).post('/api/v1/auth/register').send({ email: '', password: '' });
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toMatch(/Username and password are required/);

            res = await request(app).post('/api/v1/auth/register').send({ email: 'a@b.com' });
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toMatch(/Username and password are required/);

            res = await request(app).post('/api/v1/auth/register').send({ password: '123' });
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toMatch(/Username and password are required/);
        });

        it('should return 409 if user already exists', async () => {
            prisma.user = { findUnique: jest.fn().mockResolvedValue({ id: 1 }) };
            const res = await request(app).post('/api/v1/auth/register').send({ email: 'test@x.com', password: '12312312' });
            expect(res.statusCode).toBe(409);
            expect(res.body.error).toMatch(/User already exists/);
        });

        it('should create user and send verification email', async () => {
            prisma.user = {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ username: 'test@x.com' }),
            };
            prisma.emailVerification = {
                create: jest.fn().mockResolvedValue({ token: 'secure-token' }),
            };
            const res = await request(app).post('/api/v1/auth/register').send({ email: 'test@x.com', password: '12345123' });
            expect(res.statusCode).toBe(201);
            expect(res.body.message).toMatch(/User created successfully/);
            expect(prisma.user.create).toHaveBeenCalled();
            expect(sendEmail).toHaveBeenCalledWith(
                'test@x.com',
                expect.stringContaining('Verify'),
                expect.stringContaining('/api/v1/auth/verify?token=secure-token')
            );
        });
    });

    describe('POST /api/v1/auth/resend-verification', () => {
        it('should return 400 if email is missing', async () => {
            const res = await request(app).post('/api/v1/auth/resend-verification').send({});
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toMatch(/Email is required/);
        });

        it('should return 404 if user not found or already verified', async () => {
            prisma.user = { findUnique: jest.fn().mockResolvedValue(null) };
            let res = await request(app).post('/api/v1/auth/resend-verification').send({ email: 'notfound@x.com' });
            expect(res.statusCode).toBe(404);

            prisma.user.findUnique.mockResolvedValue({ email: 'a@b.com', verified: true });
            res = await request(app).post('/api/v1/auth/resend-verification').send({ email: 'a@b.com' });
            expect(res.statusCode).toBe(404);
        });

        it('should return 429 if rate limited', async () => {
            prisma.user = { findUnique: jest.fn().mockResolvedValue({ email: 'a@b.com', verified: false }) };
            redisClient.get.mockResolvedValue('1'); // Simulate rate limit
            const res = await request(app).post('/api/v1/auth/resend-verification').send({ email: 'a@b.com' });
            expect(res.statusCode).toBe(429);
            expect(res.body.error).toMatch(/wait before requesting/);
        });

        it('should send verification email if not rate limited', async () => {
            prisma.user = { findUnique: jest.fn().mockResolvedValue({ email: 'a@b.com', verified: false }) };
            redisClient.get.mockResolvedValue(null); // Not rate limited
            redisClient.set.mockResolvedValue();
            const res = await request(app).post('/api/v1/auth/resend-verification').send({ email: 'a@b.com' });
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toMatch(/Verification email sent/);
            expect(sendEmail).toHaveBeenCalledWith(
                'a@b.com',
                expect.stringContaining('Verify your account'),
                expect.stringContaining('/api/v1/auth/verify?token=secure-token')
            );
        });
    });

    describe('GET /api/v1/auth/verify', () => {
        it('should return 400 if token is missing', async () => {
            const res = await request(app).get('/api/v1/auth/verify');
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toMatch(/Token is required/);
        });

        it('should return 404 if token is invalid', async () => {
            prisma.user = { findFirst: jest.fn().mockResolvedValue(null) };
            prisma.emailVerification = { findFirst: jest.fn().mockResolvedValue(null) };
            const res = await request(app).get('/api/v1/auth/verify?token=badtoken');
            expect(res.statusCode).toBe(404);
            expect(res.body.error).toMatch(/Invalid or expired token/);
        });

        it('should verify user if token is valid', async () => {
            prisma.user = {
                findFirst: jest.fn().mockResolvedValue({ id: 1 }),
                update: jest.fn().mockResolvedValue({}),
                findUnique: jest.fn().mockResolvedValue({ id: 1, email: 'a@x.com', verified: false }),
            };
            prisma.emailVerification = {
                findFirst: jest.fn().mockResolvedValue({ id: 1, userId: 1, token: 'secure-token' }),
                delete: jest.fn().mockResolvedValue(),
            };
            const res = await request(app).get('/api/v1/auth/verify?token=secure-token');
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toMatch(/Email verified successfully/);
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { verified: true }
            });
            expect(prisma.emailVerification.delete).toHaveBeenCalledWith({
                where: { id: 1 }
            });
        });
    });

    describe('POST /api/v1/auth/login', () => {
        it('should return 400 if email or password missing', async () => {
            let res = await request(app).post('/api/v1/auth/login').send({ email: '', password: '' });
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toMatch(/Email and password are required/);

            res = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.com' });
            expect(res.statusCode).toBe(400);
        });

        it('should return 404 if user not found or not verified', async () => {
            prisma.user = { findUnique: jest.fn().mockResolvedValue(null) };
            let res = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.com', password: '123' });
            expect(res.statusCode).toBe(404);

            prisma.user.findUnique.mockResolvedValue({ id: 1, email: 'a@b.com', verified: false });
            res = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.com', password: '123' });
            expect(res.statusCode).toBe(404);
        });

        it('should return 401 if password is invalid', async () => {
            prisma.user = { findUnique: jest.fn().mockResolvedValue({ id: 1, email: 'a@b.com', verified: true, password: 'hashed' }) };
            security.verifyPassword.mockResolvedValue(false);
            const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.com', password: 'wrong' });
            expect(res.statusCode).toBe(401);
            expect(res.body.error).toMatch(/Invalid credentials/);
        });

        it('should login user and return user info', async () => {
            prisma.user = { findUnique: jest.fn().mockResolvedValue({ id: 1, email: 'a@b.com', verified: true, password: 'hashed' }) };
            security.verifyPassword.mockResolvedValue(true);
            redisClient.get.mockResolvedValue(null);
            redisClient.set.mockResolvedValue();
            const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.com', password: 'right' });
            expect(res.statusCode).toBe(200);
            expect(res.body.user).toEqual({ id: 1, email: 'a@b.com' });
        });
    });

    describe('POST /api/v1/auth/logout', () => {
        it('should return 400 if no session cookie', async () => {
            const res = await request(app).post('/api/v1/auth/logout');
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toMatch(/No session found/);
        });

        it('should clear session and cookie if session exists', async () => {
            redisClient.del.mockResolvedValue();
            const agent = request.agent(app);
            // Simulate cookie
            const res = await agent.post('/api/v1/auth/logout').set('Cookie', ['session=mock-session-id']);
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toMatch(/Logged out successfully/);
            expect(redisClient.del).toHaveBeenCalled();
        });
    });
});

// --- ORDER ROUTES TESTS ---

describe('Order routes', () => {
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
        redisClient.get.mockResolvedValue(null);
        redisClient.set.mockResolvedValue();
    });

    describe('POST /orders', () => {
        it('should return 400 if cart is empty', async () => {
            redisClient.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            const res = await request(app).post('/api/v1/orders');
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toMatch(/Cart is empty/);
        });

        it('should create an order and clear the cart', async () => {
            mockSession.cart.items = [{ pizzaId: 1, quantity: 2 }];
            mockSession.cart.total = 20;
            redisClient.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            const createdAt = new Date();
            const mockOrder = {
                id: 101,
                total: 20,
                createdAt,
                items: [{ pizzaId: 1, quantity: 2 }]
            };
            // Mock prisma.order.create
            if (!prisma.order) prisma.order = {};
            prisma.order.create = jest.fn().mockResolvedValue(mockOrder);
            prisma.pizza.findMany = jest.fn().mockResolvedValue([
                { id: 1, price: 10 }
            ]);

            const res = await request(app).post('/api/v1/orders');
            expect(res.statusCode).toBe(201);
            expect(res.body.orderId).toBe(101);
            expect(res.body.total).toBe(20);
            expect(Array.isArray(res.body.items)).toBe(true);
            expect(res.body.items).toEqual([{ pizzaId: 1, quantity: 2 }]);
            expect(prisma.order.create).toHaveBeenCalledWith({
                data: {
                    sessionId: mockSessionId,
                    items: { create: [{ pizzaId: 1, quantity: 2, unitPrice: 10, totalPrice: 20 }] },
                    total: 20,
                    createdAt: expect.any(Date),
                },
                include: { items: true }
            });
            expect(redisClient.set).toHaveBeenCalled();
        });
    });

    describe('GET /orders', () => {
        it('should return a list of orders for the session', async () => {
            redisClient.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            const mockOrders = [
                {
                    id: 1,
                    createdAt: new Date('2024-01-01T10:00:00Z'),
                    total: 30,
                    status: 'delivered',
                    items: [{ pizzaId: 1, quantity: 2 }]
                },
                {
                    id: 2,
                    createdAt: new Date('2024-01-02T12:00:00Z'),
                    total: 15,
                    status: 'pending',
                    items: [{ pizzaId: 2, quantity: 1 }]
                }
            ];
            if (!prisma.order) prisma.order = {};
            prisma.order.findMany = jest.fn().mockResolvedValue(mockOrders);

            const res = await request(app).get('/api/v1/orders');
            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.body.orders)).toBe(true);
            expect(res.body.orders.length).toBe(2);
            expect(res.body.orders[0]).toHaveProperty('orderId');
            expect(res.body.orders[0]).toHaveProperty('createdAt');
            expect(res.body.orders[0]).toHaveProperty('total');
            expect(res.body.orders[0]).toHaveProperty('status');
            expect(res.body.orders[0]).toHaveProperty('items');
            expect(prisma.order.findMany).toHaveBeenCalledWith({
                where: { sessionId: mockSessionId },
                include: { items: true },
                orderBy: { createdAt: 'desc' }
            });
        });
    });

    describe('GET /orders/:id', () => {
        it('should return 400 for invalid order id', async () => {
            redisClient.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            const res = await request(app).get('/api/v1/orders/abc');
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toMatch(/Invalid order ID/);
        });

        it('should return 404 if order not found', async () => {
            redisClient.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            if (!prisma.order) prisma.order = {};
            prisma.order.findUnique = jest.fn().mockResolvedValue(null);
            const res = await request(app).get('/api/v1/orders/999');
            expect(res.statusCode).toBe(404);
            expect(res.body.error).toMatch(/Order not found/);
        });

        it('should return order details for valid order', async () => {
            redisClient.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            const mockOrder = {
                id: 10,
                createdAt: new Date('2024-01-03T15:00:00Z'),
                status: 'delivered',
                total: 25,
                items: [
                    {
                        pizzaId: 1,
                        quantity: 2,
                        pizza: { name: 'Margherita', price: 6.5 }
                    },
                    {
                        pizzaId: 2,
                        quantity: 1,
                        pizza: { name: 'Pepperoni', price: 12 }
                    }
                ]
            };
            if (!prisma.order) prisma.order = {};
            prisma.order.findUnique = jest.fn().mockResolvedValue(mockOrder);

            const res = await request(app).get('/api/v1/orders/10');
            expect(res.statusCode).toBe(200);
            expect(res.body.orderId).toBe(10);
            expect(res.body.status).toBe('delivered');
            expect(res.body.total).toBe(25);
            expect(Array.isArray(res.body.items)).toBe(true);
            expect(res.body.items[0]).toHaveProperty('pizzaId');
            expect(res.body.items[0]).toHaveProperty('name');
            expect(res.body.items[0]).toHaveProperty('quantity');
            expect(res.body.items[0]).toHaveProperty('unitPrice');
            expect(res.body.items[0]).toHaveProperty('totalPrice');
            expect(prisma.order.findUnique).toHaveBeenCalledWith({
                where: { id: 10, sessionId: mockSessionId },
                include: { items: { include: { "pizza": true } } }
            });
        });
    });
});
