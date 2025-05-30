FROM node:24-alpine

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy app source
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Expose the application port
EXPOSE 3000

# Start the app
CMD ["npm", "run", "start"]