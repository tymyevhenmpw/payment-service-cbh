# Base image
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy and install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Generate Prisma client
RUN npm run prisma:generate

# Build TypeScript
RUN npm run build

# Expose port and start app
EXPOSE 4002
CMD [ "npm", "start" ]
