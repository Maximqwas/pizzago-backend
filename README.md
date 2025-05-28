# PizzaGo Backend

This project contains PizzaGo backend implementation in NodeJS

## Project structure

`index.js` - entry point. If you want to launch application - use this file
`app.js` - application definition. This file defines `app` and sets up all routes. Such separation makes unit testing possible. You can use app without spinning up actual web server
`prisma` - Prisma ORM folder
`prisma/schema.prisma` - contains definitions for all entities used in project

## Deploying

### Prerequisites

Make sure you have NPM and NodeJS installed. On most Linux distributions you need to install `nodejs` and `npm` packages using your favorite package manager. Examples for common distros:

#### Ubuntu/Debian

`sudo apt install nodejs npm`

#### Arch-based (including Manjaro and co.)

`sudo pacman -S nodejs npm`

#### CentOS/RHEL

```bash
sudo yum install epel-release
sudo yum install nodejs npm
```

### Setup

Enter directory containing project and run:

```bash
npm i
```

### Launch

In project directory, run

```bash
npm run start
```
