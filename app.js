const express = require("express");
const cors = require("cors");
const prisma = require("./prisma.js");

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

// Order routes
// TODO

// IAM routes (auth, register, etc.)
// TODO

module.exports = app;