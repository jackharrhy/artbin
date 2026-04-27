FROM node:25-alpine AS development-dependencies-env
WORKDIR /app
COPY ./package.json /app/
RUN npm install

FROM node:25-alpine AS production-dependencies-env
WORKDIR /app
COPY ./package.json /app/
RUN npm install --omit=dev

FROM node:25-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build

FROM node:25-alpine
COPY ./package.json /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
WORKDIR /app
CMD ["npm", "run", "start"]
