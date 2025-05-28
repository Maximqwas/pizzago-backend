const PrismaClient = require('@prisma/client').PrismaClient;
require('dotenv').config();

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL,
        },
    },
});
module.exports = prisma;
