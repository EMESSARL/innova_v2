FROM node:20
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE 41000
CMD ["npm", "start"]
