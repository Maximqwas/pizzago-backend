const request = require('supertest');
const app = require('../src/app.js');
const db = require('../src/prisma.js');
const redis = require('../src/redis_client.js');
const {hashPassword} = require('../src/security.js');

async function insertPizzas() {
    // Generate set of tags
    const tags = [
        `tag1`,
        `tag2`,
        `tag3`
    ];
    // Insert tags into the database
    let promises = [];
    for (const tag of tags) {
        promises.push(
            db.tag.upsert({
                where: { key: tag.toLowerCase() },
                update: {},
                create: { name: tag, key: tag.toLowerCase() }
            })
        );
    }
    await Promise.all(promises);
    // Insert pizzas into the database
    const pizzas = [
        { name: `Margherita`, description: 'Classic pizza with tomatoes and mozzarella', tags: [tags[0]], price: 12.99 },
        { name: `Pepperoni`, description: 'Spicy pepperoni with cheese', tags: [tags[1], tags[2]], price: 12.99 },
        { name: `Vegetarian`, description: 'Loaded with fresh vegetables', tags: [], price: 12.99 }
    ];
    promises = [];
    for (const pizza of pizzas) {
        promises.push(db.pizza.create({
            data: {
                name: pizza.name,
                description: pizza.description,
                price: pizza.price,
                tags: {
                    connectOrCreate: pizza.tags.map(tag => ({
                        where: { key: tag.toLowerCase() },
                        create: { name: tag, key: tag.toLowerCase() }
                    }))
                }
            }
        }));
    }
    await Promise.all(promises);
}

async function clearDatabase() {
    await db.order.deleteMany();
    await db.orderItem.deleteMany();
    await db.pizza.deleteMany();
    await db.tag.deleteMany();
    await db.user.deleteMany();
}

beforeAll(async () => {
    await clearDatabase();
});

afterAll(async () => {
    await clearDatabase();
    await redis.quit();
});

describe('GET /api/v1/pizzas', () => {
    it('should return status 200 and list of pizzas', async () => {
        await insertPizzas();
        const response = await request(app)
            .get('/api/v1/pizzas')
            .expect(200);

        expect(response.body["results"]).toHaveLength(3);
        expect(response.body["results"][0]).toHaveProperty('name');
        expect(response.body["results"][0]).toHaveProperty('description');
        expect(response.body["results"][0]).toHaveProperty('tags');
    });

    it('should return status 200 and filtered pizzas by tag', async () => {
        const response = await request(app)
        .get('/api/v1/pizzas')
        .query({ tags: 'tag1' })
        .expect(200);

        expect(response.body["results"]).toHaveLength(1);
        expect(response.body["results"][0].name).toBe('Margherita');
    });

    it('should return status 200 and filtered pizzas by multiple tags', async () => {
        const response = await request(app)
            .get('/api/v1/pizzas')
            .query({ tags: 'tag2,tag3' });

        expect(response.body["results"]).toHaveLength(1);
        expect(response.body["results"][0].name).toBe('Pepperoni');
    });
});

// Cart tests

async function getSession() {
    const res = await request(app)
        .get('/api/v1/cart')
        .expect(200);
    // Read cookie from response
    const sessionCookie = res.headers['set-cookie'].find(cookie => cookie.startsWith('session='));
    if (!sessionCookie) {
        throw new Error('Session cookie not found');
    }
    // Extract session ID from cookie
    const sessionId = sessionCookie.split(';')[0].split('=')[1];
    return sessionId;
}

describe('/api/v1/cart', () => {
    it('should return an empty cart', async () => {
        const response = await request(app)
            .get('/api/v1/cart')
            .expect(200);

        expect(response.body).toEqual({ total: 0, items: [] });
    });

    it('should add a pizza to the cart', async () => {
        // Get pizzas from DB
        const pizzas = await db.pizza.findMany();

        const response = await request(app)
            .post('/api/v1/cart')
            .send({ pizzaId: pizzas[0].id, quantity: 2 });
        if (response.status !== 200) {
            console.error('Response body:', response.body);
        }
        expect(response.status).toBe(200);

        expect(response.body).toEqual({ total: pizzas[0].price * 2, items: [{ pizzaId: pizzas[0].id, quantity: 2 }] });
    });

    it('should update the quantity of a pizza in the cart', async () => {
        const pizzas = await db.pizza.findMany();
        await request(app)
            .post('/api/v1/cart')
            .send({ pizzaId: pizzas[0].id, quantity: 1 })
            .expect(200);

        const response = await request(app)
            .post('/api/v1/cart')
            .send({ pizzaId: pizzas[0].id, quantity: 3 })
            .expect(200);

        expect(response.body).toEqual({ total: pizzas[0].price * 3, items: [{ pizzaId: pizzas[0].id, quantity: 3 }] });
    });

    it('should remove a pizza from the cart', async () => {
        const pizzas = await db.pizza.findMany();
        const pizzaId = pizzas[0].id;
        // Get a session and reuse it for both requests
        const sessionId = await getSession();

        await request(app)
            .post('/api/v1/cart')
            .set('Content-Type', 'application/json')
            .set('Cookie', `session=${sessionId}`)
            .send({ pizzaId: pizzaId, quantity: 2 })
            .expect(200);

        const response = await request(app)
            .delete(`/api/v1/cart/${pizzaId}`)
            .set('Cookie', `session=${sessionId}`)
            .expect(200);

        expect(response.body).toEqual({ total: 0, items: [] });
    });
});

// Order tests
describe('/api/v1/orders', () => {
    it('should create an order', async () => {
        const pizzas = await db.pizza.findMany();
        const sessionId = await getSession();

        // Add pizzas to the cart
        await request(app)
            .post('/api/v1/cart')
            .set('Cookie', `session=${sessionId}`)
            .send({ pizzaId: pizzas[0].id, quantity: 2 })
            .expect(200);

        // Create an order
        const response = await request(app)
            .post('/api/v1/orders')
            .set('Cookie', `session=${sessionId}`)
            .expect(201);

        expect(response.body).toHaveProperty('orderId');
        expect(response.body).toHaveProperty('total');
        expect(response.body).toHaveProperty('createdAt');
        expect(response.body).toHaveProperty('items');
        expect(response.body.total).toBe(pizzas[0].price * 2);
    });

    it('should return a list of orders', async () => {
        const sessionId = await getSession();
        const response = await request(app)
            .get('/api/v1/orders')
            .set('Cookie', `session=${sessionId}`)
            .expect(200);

        expect(response.body).toHaveProperty('orders');
        expect(Array.isArray(response.body.orders)).toBe(true);
    });
});

// IAM (auth/register) tests
describe('/api/v1/auth/register', () => {
    it('should register a new user', async () => {
        const response = await request(app)
            .post('/api/v1/auth/register')
            .send({
                password: 'testpassword',
                email: 'test@example.com'
            })
            .expect(201);
        expect(response.body).toHaveProperty('message');
    });
    it('should not register a user with an existing username', async () => {
        await request(app)
            .post('/api/v1/auth/register')
            .send({
                password: 'testpassword',
                email: 'test@example.com'
            })
            .expect(409);
        // Check that the user was not created again
        const user = await db.user.findUnique({
            where: { email: 'test@example.com' }
        });
        expect(user).toBeDefined();
        expect(user.email).toBe('test@example.com');
    });
    it('should not register a user with an existing email', async () => {
        await request(app)
            .post('/api/v1/auth/register')
            .send({
                password: 'testpassword',
                email: 'test@example.com'
            })
            .expect(409);
        // Check that the user was not created again
        const user = await db.user.findUnique({
            where: { email: 'test@example.com' }
        });
        expect(user).toBeDefined();
        expect(user.email).toBe('test@example.com');
    });
    it('should not register a user with an invalid email', async () => {
        await request(app)
            .post('/api/v1/auth/register')
            .send({
                password: 'testpassword',
                email: 'invalid-email'
            })
            .expect(400);
    });
    it('should not register a user with a weak password', async () => {
        await request(app)
            .post('/api/v1/auth/register')
            .send({
                password: '123',
                email: 'test_uniq@example.com'
            })
            .expect(400);
        // Check that the user was not created
        const user = await db.user.findUnique({
            where: { email: 'test_uniq@example.com' }
        });
        expect(user).toBeNull();
    });
});