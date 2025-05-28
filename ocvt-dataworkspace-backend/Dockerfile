FROM node:20
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE 44000
CMD ["npm", "start"]
