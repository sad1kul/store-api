# Smoke Time Store API

Backend REST API service for Smoke Time Store — South Africa's premier tobacco and smoke product e-commerce platform.

## Features

- **Authentication**: JWT access token + httpOnly refresh token cookie rotation
- **Products**: Search, filter, pagination, category & slug lookups
- **Orders**: Server-side price recalculations, bulk pricing tier evaluation, VAT (15%), stock deduction, price tampering protection (409)
- **Cart**: Server-validated cart pricing single source of truth (`/api/cart/validate`)
- **Wholesale**: Application workflow, admin review & role promotion
- **Content**: Dynamic banner & hero content configuration
- **Users**: Admin management

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm run start
```
