const prisma = require('./prisma.js');

// Insert pizzas
const pizza_tags = [
    "vegan",
    "vegetarian",
    "gluten-free",
    "spicy"
];

function combinations(arr, k) {
    const result = [];
    const f = (start, curr) => {
        if (curr.length === k) {
            result.push(curr);
            return;
        }
        for (let i = start; i < arr.length; i++) {
            f(i + 1, [...curr, arr[i]]);
        }
    };
    f(0, []);
    return result;
}

async function insertPizzas(client) {
    const tag_combinations = combinations(pizza_tags, 2);
    const pizzas = [];
    for (let i = 0; i < tag_combinations.length; i++) {
        const tags = tag_combinations[i];
        const pizza = prisma.pizza.create({
            data: {
                name: `Pizza ${i + 1}`,
                description: `A delicious pizza with ${tags.join(' and ')}`,
                tags: {
                    connectOrCreate: tags.map(tag => ({
                        where: { key: tag },
                        create: { key: tag, name: tag }
                    }))
                },
                price: Math.floor(Math.random() * 20) + 5, // Random price between 5 and 25
            },
            include: {
                tags: true
            }
        });
        pizzas.push(pizza);
    }
    return Promise.all(pizzas)
        .then(results => {
            console.log(`Inserted ${results.length} pizzas`);
            return results;
        })
        .catch(error => {
            console.error('Error inserting pizzas:', error);
            throw error;
        });
}

async function main() {
    try {
        console.log("Inserting pizzas...");
        const pizzas = await insertPizzas(prisma);
        console.log("Pizzas inserted successfully:", pizzas);
    } catch (error) {
        console.error("Error during insertion:", error);
    } finally {
        await prisma.$disconnect();
    }
}
main().catch(e => {
    console.error(e);
    process.exit(1);
});