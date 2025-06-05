const express = require("express");
const cors = require("cors");
const prisma = require("./prisma.js");
const crypto = require("crypto");
const redisClient = require("./redis_client.js");

const SESSION_LIFETIME = 60*60*24*3;
const SESSION_PREFIX = "pizzago_session:";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Pizza routes

// Helper function to perform flexible search

async function findPizzasWithSingleTag(tag, offset, limit) {
    // We use a small trick here
    // When searching with multiple tags, we can use the `some` operator
    // to perform search in a single query
    // With multiple tags, we need to use raw SQL query to select pizza IDs and then select pizzas by IDs
    // Otherwise Prisma simply won't map the results (raw query)
    const results = prisma.pizza.findMany({
        where: {
            tags: {
                some: {
                    tagKey: { in: [tag,] }
                }
            }
        },
        include: { tags: { include: { tag: { select: { name: true } } } } }, // Select tag names
        skip: offset,
        take: limit,
    });
    const count = prisma.pizza.count({
        where: {
            tags: {
                some: {
                    tagKey: { in: [tag,] }
                }
            }
        }
    });
    return Promise.all([results, count]).then(([pizzas, count]) => {
        return {
            pizzas,
            count
        };
    });
}

async function findPizzasWithMultipleTags(tags, offset, limit) {
    // Raw SQL to find pizzas that have ALL specified tags
    const keysSql = tagKeys.map(k => `'${k}'`).join(',');
    const rawResult = await prisma.$queryRawUnsafe(`
        SELECT pizza_id
        FROM pizza_tag
        WHERE tag_key IN (${keysSql})
        GROUP BY pizza_id
        HAVING COUNT(DISTINCT tag_key) = ${tagKeys.length}
        ORDER BY pizza_id
        LIMIT ? OFFSET ?
    `, limit, offset);

    const pizzaIds = rawResult.map(r => r.pizza_id);

    const pizzas = await prisma.pizza.findMany({
        where: { id: { in: pizzaIds } },
        include: { tags: { include: { tag: { select: { name: true } } } } } // Select tag names
    });

    return {
        pizzas,
        count: pizzaIds.length
    };
}

async function findPizzas(tagKeys, offset, limit) {
    if (!Array.isArray(tagKeys)) {
        throw new Error('tagKeys must be an array');
    }

    if (tagKeys.length === 0) {
        // If no tags provided, return all pizzas
        return Promise.all([
            prisma.pizza.findMany({
                include: { tags: { select: { name: true } } }, // Select tag names
                skip: offset,
                take: limit
            }),
            prisma.pizza.count()
        ]).then(([pizzas, count]) => {
            return {
                pizzas,
                count
            };
        });
    } else if (tagKeys.length === 1) {
        // If a single tag is provided, use the single tag search
        return findPizzasWithSingleTag(tagKeys[0], offset, limit);
    }
    // If multiple tags are provided, use the multiple tags search
    return findPizzasWithMultipleTags(tagKeys, offset, limit);
}


/*
 * Get all pizzas
 * Supports search by tag and paging
*/
app.get("/pizzas", async (req, res) => {
    let tags = req.query.tags ? req.query.tags.split(",") : [];
    // Transform to lowercase and strip spaces if needed
    tags = tags.map(tag => tag.toLowerCase().trim());
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.page) || 0;

    if (limit < 0 || limit > 100) {
        console.debug(`Invalid limit passed: ${limit}. You should pass a limit value between 0 and 100 inclusive. Omit this value to use default value - 20`);
        return res.status(400).json({ error: "Limit must be between 0 and 100" });
    }

    const { pizzas, count } = await findPizzas(tags, offset, limit);

    res.json({
        total: count,
        limit: limit,
        offset: offset,
        results: [
            ...pizzas.map(pizza => ({
                id: pizza.id,
                name: pizza.name,
                tags: pizza.tags.map(tag => tag.name),
                price: pizza.price,
                description: pizza.description,
            }))
        ]
    });
});

app.get("/pizzas/:id", async (req, res) => {
    const pizzaId = parseInt(req.params.id);
    if (isNaN(pizzaId)) {
        return res.status(400).json({ error: "Invalid pizza ID" });
    }

    const pizza = await prisma.pizza.findUnique({
        where: { id: pizzaId },
        include: { tags: { include: { tag: { select: { name: true } } } } } // Select tag names
    });

    if (!pizza) {
        return res.status(404).json({ error: "Pizza not found" });
    }

    res.json({
        id: pizza.id,
        name: pizza.name,
        tags: pizza.tags.map(tag => tag.tag.name),
        ingredients: pizza.ingredients,
        price: pizza.price,
        description: pizza.description,
    });
});

// Cart routes
function generateSessionId() {
    return crypto.randomBytes(32).toString('base64url');
}

function sessionIdToRedisKey(sessionId) {
    return `${SESSION_PREFIX}${sessionId}`;
}

async function createSession() {
    const sessionId = generateSessionId();
    const sessionData = {
        id: sessionId,
        createdAt: new Date(),
        updatedAt: new Date(),
        cart: {
            items: [],
            total: 0
        }
    };
    await redisClient.set(sessionIdToRedisKey(sessionId), JSON.stringify(sessionData), 'EX', SESSION_LIFETIME); // Set expiration to 1 hour
    return sessionData;
}

async function getExistingSession(sessionId) {
    const sessionData = await redisClient.get(sessionId);
    if (sessionData) {
        return JSON.parse(sessionData);
    }
    return null;
}

async function getOrCreateSession(sessionId) {
    if (!sessionId) {
        return createSession();
    }
    const sessionData = await getExistingSession(sessionId);
    if (sessionData) {
        return sessionData;
    }
    return createSession();
}

async function getSessionForRequest(req, res) {
    let sessionId = req?.cookies?.session;
    if (!sessionId) {
        sessionId = generateSessionId();
        res.cookie('session', sessionId, { httpOnly: true, secure: true });
    }
    return getOrCreateSession(sessionId);
}

// This function takes internal cart info and transforms it to the format expected by the client
function transformCartInfo(info) {
    return info;
}

app.get("/cart", async (req, res) => {
    const session = await getSessionForRequest(req, res);
    res.json(transformCartInfo(session.cart));
});

app.post("/cart", async (req, res) => {
    const session = await getSessionForRequest(req, res);
    const { pizzaId, quantity } = req.body;

    if (!pizzaId || isNaN(pizzaId) || !quantity || isNaN(quantity)) {
        return res.status(400).json({ error: "Invalid pizza ID or quantity" });
    }

    const pizza = await prisma.pizza.findUnique({ where: { id: pizzaId } });
    if (!pizza) {
        return res.status(404).json({ error: "Pizza not found" });
    }

    // Add pizza to cart
    const existingItem = session.cart.items.find(item => item.pizzaId === pizzaId);
    if (existingItem) {
        existingItem.quantity += quantity;
    } else {
        session.cart.items.push({ pizzaId, quantity });
    }
    session.cart.total += pizza.price * quantity;

    // Update session in Redis
    await redisClient.set(sessionIdToRedisKey(session.id), JSON.stringify(session), 'EX', SESSION_LIFETIME); // Set expiration to 1 hour

    res.json(transformCartInfo(session.cart));
});

app.delete("/cart/:pizzaId", async (req, res) => {
    const session = await getSessionForRequest(req, res);
    const pizzaId = parseInt(req.params.pizzaId);

    if (isNaN(pizzaId)) {
        return res.status(400).json({ error: "Invalid pizza ID" });
    }

    const pizzaIndex = session.cart.items.findIndex(item => item.pizzaId === pizzaId);
    if (pizzaIndex === -1) {
        return res.status(404).json({ error: "Pizza not found in cart" });
    }

    const pizza = await prisma.pizza.findUnique({ where: { id: pizzaId } });
    if (!pizza) {
        return res.status(404).json({ error: "Pizza not found" });
    }

    // Remove pizza from cart
    session.cart.total -= pizza.price * session.cart.items[pizzaIndex].quantity;
    session.cart.items.splice(pizzaIndex, 1);

    // Update session in Redis
    await redisClient.set(sessionIdToRedisKey(session.id), JSON.stringify(session), 'EX', SESSION_LIFETIME);

    res.json(transformCartInfo(session.cart));
});

app.delete("/cart", async (req, res) => {
    const session = await getSessionForRequest(req, res);
    session.cart.items = [];
    session.cart.total = 0;

    // Update session in Redis
    await redisClient.set(sessionIdToRedisKey(session.id), JSON.stringify(session), 'EX', SESSION_LIFETIME);

    res.json(transformCartInfo(session.cart));
});

// Order routes
// TODO

// IAM routes (auth, register, etc.)
// TODO

module.exports = app;