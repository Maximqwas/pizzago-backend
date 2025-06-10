require("./instrument.js");
const express = require("express");
const cors = require("cors");
const prisma = require("./prisma.js");
const crypto = require("crypto");
const redisClient = require("./redis_client.js");
const {
    hashPassword,
    verifyPassword,
    getSecureToken
} = require("./security.js");
const {sendEmail} = require("./mail.js");
const cookieParser = require("cookie-parser");
require('dotenv').config();

const SESSION_LIFETIME = 60*60*24*3;
const SESSION_PREFIX = "pizzago_session:";
const EMAIL_RATE_LIMIT = 60; // ... seconds to wait before sending another email
const EMAIL_RATE_LIMIT_PREFIX = "email_rate_limit:";

const BASE_DOMAIN = process.env.BASE_DOMAIN || "http://localhost:3000";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());

function generateSessionId() {
    return crypto.randomBytes(32).toString('base64url');
}

function sessionIdToRedisKey(sessionId) {
    return `${SESSION_PREFIX}${sessionId}`;
}

function constructSessionData(sessionId){
    return {
        id: sessionId,
        createdAt: new Date(),
        updatedAt: new Date(),
        cart: {
            items: [],
            total: 0
        },
        userId: null // Initially no user is associated with the session
    };
}

async function createSession(sessionId) {
    const sessionData = constructSessionData(sessionId);
    await redisClient.set(sessionIdToRedisKey(sessionId), JSON.stringify(sessionData), 'EX', SESSION_LIFETIME); // Set expiration to 1 hour
    return sessionData;
}

async function getExistingSession(sessionId) {
    const sessionData = await redisClient.get(sessionIdToRedisKey(sessionId));
    if (sessionData) {
        return JSON.parse(sessionData);
    }
    return null;
}

async function getOrCreateSession(sessionId) {
    if (!sessionId) {
        return createSession(sessionId);
    }
    const sessionData = await getExistingSession(sessionId);
    if (sessionData) {
        return sessionData;
    }
    return createSession(sessionId);
}

async function getSessionForRequest(req, res) {
    let sessionId = req?.cookies?.session;
    if (!sessionId) {
        sessionId = generateSessionId();
        res.cookie('session', sessionId, { httpOnly: true, secure: true });
    }
    return getOrCreateSession(sessionId);
}

// Middleware
function sessionMiddleware(req, res, next) {
    // This middleware is used to get or create a session for the request
    // It will set the session cookie if it doesn't exist
    getSessionForRequest(req, res)
        .then(session => {
            req.session = session; // Attach session to request
            next();
        })
        .catch(err => {
            console.error("Error getting session:", err);
            res.status(500).json({ error: "Internal server error" });
        });
}

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
                    key: { in: [tag.toLowerCase(),] }
                }
            }
        },
        include: { tags: { select: { name: true } } }, // Select tag names
        skip: offset,
        take: limit,
    });
    const count = prisma.pizza.count({
        where: {
            tags: {
                some: {
                    key: tag.toLowerCase() // Ensure case-insensitive search
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

async function findPizzasWithMultipleTags(tags, offset=0, limit=20) {
    // Raw SQL to find pizzas that have ALL specified tags

    // Ensure that tags are alphanumeric and lowercase
    tags = tags.map(tag => tag.toLowerCase().trim()).filter(tag => /^[a-z0-9]+$/.test(tag));
    // Ensure that offset and limit are valid numbers
    offset = parseInt(offset) || 0;
    limit = parseInt(limit) || 20;

    const keysSql = tags.map(k => `'${k}'`).join(',');
    const rawResult = await prisma.$queryRawUnsafe(`
        SELECT "A"
        FROM "_PizzaTags"
        WHERE "B" IN (${keysSql})
        GROUP BY "A"
        HAVING COUNT(DISTINCT "B") = ${tags.length}
        ORDER BY "A"
        LIMIT ${limit} OFFSET ${offset}
    `);

    const pizzaIds = rawResult.map(r => r.A);

    const pizzas = await prisma.pizza.findMany({
        where: { id: { in: pizzaIds } },
        include: { tags: { select: { name: true } } }, // Select tag names
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
app.get("/api/v1/pizzas", async (req, res) => {
    let tags = req.query.tags ? req.query.tags.split(",") : [];
    // Transform to lowercase and strip spaces if needed
    tags = tags.map(tag => tag.toLowerCase().trim());
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.page) || 0;

    if (limit < 0 || limit > 100) {
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

app.get("/api/v1/pizzas/:id", async (req, res) => {
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

// This function takes internal cart info and transforms it to the format expected by the client
function transformCartInfo(info) {
    return info;
}

app.get("/api/v1/cart", sessionMiddleware, async (req, res) => {
    res.json(transformCartInfo(req.session.cart));
});

app.post("/api/v1/cart", sessionMiddleware, async (req, res) => {
    if (!req.body || !req.body.pizzaId || !req.body.quantity) {
        return res.status(400).json({ error: "Pizza ID and quantity are required" });
    }
    const pizzaId = parseInt(req.body.pizzaId);
    const quantity = parseInt(req.body.quantity);

    if (!pizzaId || isNaN(pizzaId) || !quantity || isNaN(quantity)) {
        return res.status(400).json({ error: "Invalid pizza ID or quantity" });
    }

    const pizza = await prisma.pizza.findUnique({ where: { id: pizzaId } });
    if (!pizza) {
        return res.status(404).json({ error: "Pizza not found" });
    }

    // Add pizza to cart
    const existingItem = req.session.cart.items.find(item => item.pizzaId === pizzaId);
    if (existingItem) {
        existingItem.quantity += quantity;
    } else {
        req.session.cart.items.push({ pizzaId, quantity });
    }
    req.session.cart.total += pizza.price * quantity;

    // Update session in Redis
    await redisClient.set(sessionIdToRedisKey(req.session.id), JSON.stringify(req.session), 'EX', SESSION_LIFETIME); // Set expiration to 1 hour

    res.json(transformCartInfo(req.session.cart));
});

app.delete("/api/v1/cart/:pizzaId", sessionMiddleware, async (req, res) => {
    const pizzaId = parseInt(req.params.pizzaId);

    if (isNaN(pizzaId)) {
        return res.status(400).json({ error: "Invalid pizza ID" });
    }

    const pizzaIndex = req.session.cart.items.findIndex(item => item.pizzaId === pizzaId);
    if (pizzaIndex === -1) {
        return res.status(404).json({ error: "Pizza not found in cart" });
    }

    const pizza = await prisma.pizza.findUnique({ where: { id: pizzaId } });
    if (!pizza) {
        return res.status(404).json({ error: "Pizza not found" });
    }

    // Remove pizza from cart
    req.session.cart.total -= pizza.price * req.session.cart.items[pizzaIndex].quantity;
    req.session.cart.items.splice(pizzaIndex, 1);

    // Update session in Redis
    await redisClient.set(sessionIdToRedisKey(req.session.id), JSON.stringify(req.session), 'EX', SESSION_LIFETIME);

    res.json(transformCartInfo(req.session.cart));
});

app.delete("/api/v1/cart", sessionMiddleware, async (req, res) => {
    req.session.cart.items = [];
    req.session.cart.total = 0;

    // Update session in Redis
    await redisClient.set(sessionIdToRedisKey(req.session.id), JSON.stringify(req.session), 'EX', SESSION_LIFETIME);

    res.json(transformCartInfo(req.session.cart));
});

// Order routes
app.post("/api/v1/orders", sessionMiddleware, async (req, res) => {
    if (req.session.cart.items.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
    }

    let pizzas = await prisma.pizza.findMany({
        where: {
            id: {
                in: req.session.cart.items.map(item => item.pizzaId)
            }
        }
    });

    let cart_items = req.session.cart.items.map(item => {
        const pizza = pizzas.find(p => p.id === item.pizzaId);
        if (!pizza) {
            console.log(`Pizza with ID ${item.pizzaId} not found in database`);
            return res.status(404).json({ error: `Pizza with ID ${item.pizzaId} not found` });
        }
        return {
            pizzaId: item.pizzaId,
            quantity: item.quantity,
            unitPrice: pizza.price, // Assuming price is stored in the pizza object
            totalPrice: item.quantity * pizza.price // Calculate total price for the item
        };
    });

    // Create order in the database
    const orderData = {
        sessionId: req.session.id,
        items: {
            create: cart_items.map(item => ({
                pizzaId: item.pizzaId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice
            }))
        },
        total: req.session.cart.total,
        createdAt: new Date(),
    };
    if (req.session.userId) {
        orderData.userId = req.session.userId;
    }
    const order = await prisma.order.create({
        data: orderData,
        include: { items: true } // Include order items in the response
    });

    // Clear the cart
    req.session.cart.items = [];
    req.session.cart.total = 0;

    // Update session in Redis
    await redisClient.set(sessionIdToRedisKey(req.session.id), JSON.stringify(req.session), 'EX', SESSION_LIFETIME);

    res.status(201).json({
        orderId: order.id,
        total: Number(order.total),
        createdAt: order.createdAt,
        items: order.items.map(item => ({
            pizzaId: item.pizzaId,
            quantity: item.quantity
        }))
    });
});

app.get("/api/v1/orders", async (req, res) => {
    const session = await getSessionForRequest(req, res);

    // Fetch orders for the session
    const orders = await prisma.order.findMany({
        where: { sessionId: session.id },
        include: { items: true }, // Include order items
        orderBy: { createdAt: 'desc' } // Most recent first
    });

    res.json({
        orders: orders.map(order => ({
            orderId: order.id,
            createdAt: order.createdAt,
            total: order.total,
            status: order.status,
            items: order.items.map(item => ({
                pizzaId: item.pizzaId,
                quantity: item.quantity
            }))
        }))
    });
});

app.get("/api/v1/orders/:id", async (req, res) => {
    const session = await getSessionForRequest(req, res);
    const orderId = parseInt(req.params.id);

    if (isNaN(orderId)) {
        return res.status(400).json({ error: "Invalid order ID" });
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId, sessionId: session.id },
        include: { 
            items: {
                include: {
                    pizza: true
                }
            }
        }
    });

    if (!order) {
        return res.status(404).json({ error: "Order not found" });
    }

    res.json({
        orderId: order.id,
        createdAt: order.createdAt,
        status: order.status,
        total: order.total,
        items: order.items.map(item => ({
            pizzaId: item.pizzaId,
            name: item.pizza.name,
            quantity: item.quantity,
            unitPrice: item.pizza.price,
            totalPrice: item.quantity * item.pizza.price
        }))
    });
});

// IAM routes (auth, register, etc.)
function isEmailRateLimited(email) {
    const key = `${EMAIL_RATE_LIMIT_PREFIX}${email}`;
    return redisClient.get(key).then(v => {
        if (v) {
            return true; // Rate limit applied
        } else {
            redisClient.set(key, '1', 'EX', EMAIL_RATE_LIMIT); // Set rate limit for email
            return false; // No rate limit applied
        }
    });
}

function validateEmail(email) {
    // Simple email validation regex
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
}

function validatePassword(password) {
    // Password must be at least 8 characters long
    return password && password.length >= 8;
}

app.post("/api/v1/auth/register", sessionMiddleware, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Username and password are required" });
    }

    // Validate email format
    if (!validateEmail(email)) {
        return res.status(400).json({ error: "Invalid email format" });
    }

    // Validate password strength
    if (!validatePassword(password)) {
        return res.status(400).json({ error: "Password must be at least 8 characters long" });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
        return res.status(409).json({ error: "User already exists" });
    }

    // Create new user
    const hashedPassword = await hashPassword(password);
    const newUser = await prisma.user.create({
        data: {
            email,
            password: hashedPassword,
            verified: false, // Default to not verified
        }
    });

    // Send verification email (placeholder function)
    const token = getSecureToken();
    await prisma.emailVerification.create({
        data: {
            userId: newUser.id,
            token: token,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Token valid for 24 hours
            email: newUser.email
        }
    });
    const verificationLink = `${BASE_DOMAIN}/api/v1/auth/verify?token=${token}`;
    // Note: no need to rate limit here
    // We explicitly check if email is already registered
    // So if user has already requested verification email,
    // we will deny earlier in this function with "user already exists"
    sendEmail(newUser.username, "Verify your account", `Welcome to PizzaGo! Click the link to verify your account: ${verificationLink}`);

    res.status(201).json({ message: "User created successfully. Please check your email to verify your account." });
});

app.post("/api/v1/auth/resend-verification", sessionMiddleware, async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    // Check if user exists and is unverified
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.verified) {
        return res.status(404).json({ error: "User not found or already verified" });
    }

    // Check if email is rate limited
    const isRateLimited = await isEmailRateLimited(email);
    if (isRateLimited) {
        return res.status(429).json({ error: "Please wait before requesting another verification email." });
    }

    // Send verification email
    const token = getSecureToken();
    const verificationLink = `${BASE_DOMAIN}/api/v1/auth/verify?token=${token}`;
    sendEmail(user.email, "Verify your account", `Click the link to verify your account: ${verificationLink}`);

    res.json({ message: "Verification email sent." });
});

app.get("/api/v1/auth/verify", async (req, res) => {
    const { token } = req.query;
    if (!token) {
        return res.status(400).json({ error: "Token is required" });
    }

    // Find user by token
    const verificationRequest = await prisma.emailVerification.findFirst({
        where: { token: token }
    });
    const user = verificationRequest ? await prisma.user.findUnique({ where: { id: verificationRequest.userId } }) : null;
    if (!verificationRequest || !user) {
        return res.status(404).json({ error: "Invalid or expired token" });
    }

    // Check if user is already verified
    if (user.verified) {
        return res.status(400).json({ error: "User already verified" });
    }

    // Mark user as verified
    Promise.all([
        prisma.user.update({
            where: { id: user.id },
            data: { verified: true } // Clear the token after verification
        }),
        prisma.emailVerification.delete({
            where: { id: verificationRequest.id }
        })
    ]);

    res.json({ message: "Email verified successfully." });
});

app.post("/api/v1/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }

    // Find user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.verified) {
        return res.status(404).json({ error: "User not found or not verified" });
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
    }

    // Generate session token (placeholder logic)
    const sessionToken = getSecureToken();

    // Set session in Redis
    redisClient.get(sessionIdToRedisKey(sessionToken)).then(sessionData => {
        if (!sessionData) {
            sessionData = constructSessionData();
            sessionData.userId = user.id;
            redisClient.set(sessionIdToRedisKey(sessionToken), JSON.stringify(sessionData), 'EX', SESSION_LIFETIME);
        } else {
            sessionData = JSON.parse(sessionData);
            sessionData.userId = user.id; // Associate user with session
            sessionData.updatedAt = new Date();
            redisClient.set(sessionIdToRedisKey(sessionToken), JSON.stringify(sessionData), 'EX', SESSION_LIFETIME);
        }
    });

    res.json({
        user: {
            id: user.id,
            email: user.email
        }
    });
});

app.post("/api/v1/auth/logout", async (req, res) => {
    const sessionId = req?.cookies?.session;
    if (!sessionId) {
        return res.status(400).json({ error: "No session found" });
    }

    // Invalidate session in Redis
    await redisClient.del(sessionIdToRedisKey(sessionId));

    // Clear cookie
    res.clearCookie('session');

    res.json({ message: "Logged out successfully." });
});

app.get("/api/v1/bug", (req, res) => {
    // This endpoint is for testing purposes
    // It will throw an error to test Sentry integration
    throw new Error("This is a test bug!");
});

module.exports = app;
