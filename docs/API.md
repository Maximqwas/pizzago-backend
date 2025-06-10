This document describes API endpoints, exposed by PizzaGo backend

## General

PizzaGo uses a REST V2 HTTP API. All request paths start with `/api/v<current version>/`. Current version is 1, so prefix all paths with `/api/v1/`, for example:  
`/pizzas` → `/api/v1/pizzas`

For floating-point values, use dot notation (e.g., `12.34`).

## 🍕 Pizza Query API Specification

---

### 📘 **GET `/pizzas`**

#### 🔸 Description:

Retrieve a list of available pizzas, optionally filtered by tags and paginated.

---

### 🔸 Query Parameters:

|Name|Type|Format|Required|Description|
|---|---|---|---|---|
|`tags`|string|Comma-separated list of lowercase tags (`tag1,tag2`)|_optional_|Filters pizzas by one or more tags (e.g., `spicy`, `vegan`). Case-sensitive: **lowercase only**.|
|`limit`|integer|Unsigned integer|_optional_|Maximum number of results to return. Default is `20`. Max is `100`.|
|`offset`|integer|Unsigned integer|_optional_|Number of records to skip for pagination. Default is `0`.|

### 🔸 Response Format

```json
{
  "total": 125,
  "limit": 10,
  "offset": 0,
  "results": [
    {
      "id": 42,
      "name": "Spicy Vegan Deluxe",
      "tags": ["spicy", "vegan"],
      "image": "http://static.pizzago.com/img/pizza_42.jpg",
      "prices": {
        "25": 8.99,
        "30": 10.99,
        "42": 13.99
      }
    }
  ]
}
```

#### 🔸 Field Definitions:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`total`|integer|Unsigned integer|**yes**|Total number of pizzas matching the query.|
|`limit`|integer|Unsigned integer|**yes**|Maximum number of results returned in this response.|
|`offset`|integer|Unsigned integer|**yes**|Starting index (for pagination).|
|`results`|array of object|List of pizza summary objects|**yes**|List of returned pizzas.|

Each item in `results`:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`id`|integer|Unsigned integer|**yes**|Unique identifier of the pizza.|
|`name`|string|UTF-8, max 64 characters|**yes**|Pizza name, title-cased.|
|`tags`|string[]|Array of lowercase strings|**yes**|Tags describing pizza (e.g., `["vegan"]`).|
|`image`|string|Full URL|**yes**|Full image URL for the pizza.|
|`prices`|object|Map of sizes to price|**yes**|Size-based pricing in local currency.|

---

## 📘 **GET `/pizzas/:id`**

#### 🔸 Description:

Returns full detail of a specific pizza, identified by ID.

---

### 🔸 Path Parameters:

|Name|Type|Format|Required|Description|
|---|---|---|---|---|
|`id`|integer|Unsigned integer|**yes**|Unique pizza ID to retrieve.|

---

### 🔸 Response Format

```json
{
  "id": 42,
  "name": "Spicy Vegan Deluxe",
  "ingredients": ["tomato", "jalapeños", "vegan cheese"],
  "tags": ["spicy", "vegan"],
  "sizes": [25, 30, 42],
  "prices": {
    "25": 8.99,
    "30": 10.99,
    "42": 13.99
  },
  "image": "http://static.pizzago.com/img/pizza_42.jpg"
}
```

#### 🔸 Field Definitions:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`id`|integer|Unsigned integer|**yes**|Unique pizza ID|
|`name`|string|UTF-8, max 64 characters|**yes**|Pizza display name, title-cased|
|`ingredients`|string[]|Array of strings in lowercase|**yes**|Ingredient names in lowercase|
|`tags`|string[]|Array of lowercase strings|**yes**|Descriptive tags (`vegan`, `spicy`, etc.)|
|`sizes`|int[]|List of available sizes|**yes**|Size options for the pizza|
|`prices`|object|Map of sizes to price|**yes**|Prices for all sizes in local currency|
|`image`|string|Full URL|**yes**|Full URL to an image|

---

## 🛒 `/cart` Endpoint Specification

---

### 📘 **GET `/cart`**

#### 🔸 Description:

Returns the current user’s cart, grouped into `pizzas` and `extras`.

---

### 🔸 Response Format:

```json
{
  "pizzas": [
    {
      "pizzaId": 1,
      "name": "Margherita",
      "quantity": 2,
      "unitPrice": 6.50,
      "totalPrice": 13.00
    }
  ],
  "extras": [
    {
      "type": "drink",
      "name": "Cola",
      "quantity": 1,
      "unitPrice": 2.00,
      "totalPrice": 2.00
    },
    {
      "type": "sauce",
      "name": "Garlic Dip",
      "quantity": 1,
      "unitPrice": 1.50,
      "totalPrice": 1.50
    }
  ],
  "total": 16.50
}
```

#### 🔸 Field Definitions:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`pizzas`|array|List of pizza items|**yes**|Pizza items in the cart|
|`extras`|array|List of non-pizza items|**yes**|Items like drinks, dips, tools, etc.|
|`total`|float|2-digit precision|**yes**|Total price of the cart|

Each item in `pizzas`:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`pizzaId`|integer|Unsigned integer|**yes**|Unique ID of the pizza|
|`name`|string|UTF-8, max 64 chars|**yes**|Name of the pizza|
|`quantity`|integer|Positive integer|**yes**|Quantity of this pizza in the cart|
|`unitPrice`|float|2-digit precision (e.g. 6.50)|**yes**|Price per unit|
|`totalPrice`|float|2-digit precision|**yes**|`unitPrice * quantity`|

Each item in `extras`:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`type`|string|Lowercase identifier|**yes**|Category of extra (e.g. drink, sauce)|
|`name`|string|UTF-8|**yes**|Name of the extra item|
|`quantity`|integer|Positive integer|**yes**|Quantity of this extra in the cart|
|`unitPrice`|float|2-digit precision (e.g. 2.00)|**yes**|Price per unit|
|`totalPrice`|float|2-digit precision|**yes**|`unitPrice * quantity`|

---

## 📘 **POST `/cart`**

#### 🔸 Description:

Adds or updates a pizza or extra in the cart. If `quantity` is set to 0, the item is removed.

---

### 🔸 Request Body (Pizza):

```json
{
  "pizzaId": 1,
  "quantity": 3
}
```

### 🔸 Request Body (Extra):

```json
{
  "itemId": 1,
  "quantity": 2
}
```

#### 🔸 Field Definitions:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`pizzaId`|integer|Unsigned integer|**yes**|ID of the pizza to add or update|
|`itemId`|integer|Unsigned integer|**yes**|ID of the extra item to add or update|
|`quantity`|integer|≥ 0|**yes**|Quantity to set. If `0`, the item is removed.|

---

#### 🔸 Behavior:

- If a **pizza** is not in the cart and `quantity > 0` → it is added.
    
- If a **pizza** is already in the cart → quantity is updated.
    
- If `quantity === 0` for a pizza → that pizza is removed.
    
- If an **extra** is not in the cart and `quantity > 0` → it is added.
    
- If an **extra** is already in the cart → quantity is updated.
    
- If `quantity === 0` for an extra → that extra is removed.
    

---

## 📘 **DELETE `/cart/pizza/:pizzaId`**

#### 🔸 Description:

Removes a specific pizza from the cart by its ID.

|Param|Type|Format|Required|Description|
|---|---|---|---|---|
|`pizzaId`|integer|Unsigned integer|**yes**|ID of the pizza to remove|

---

## 📘 **DELETE `/cart/extra/:itemId`**

#### 🔸 Description:

Removes a specific extra item from the cart by its ID.

|Param|Type|Format|Required|Description|
|---|---|---|---|---|
|`itemId`|integer|Unsigned integer|**yes**|ID of the extra item to remove|

---

## 📘 **DELETE `/cart`**

#### 🔸 Description:

Clears the entire cart for the current user.

- No body required.
    
- Always succeeds (even if cart is already empty).
    

---

## 📦 Orders Module – Overview

|Method|Path|Purpose|
|---|---|---|
|POST|`/orders`|Submit the current cart as an order|
|GET|`/orders`|List user's past orders|
|GET|`/orders/:id`|View specific order details|

---

## 📘 **POST `/orders`**

#### 🔸 Description:

Creates a new order using the **current authenticated user's cart**.  
Clears the cart after placing the order.

---

### 🔸 Request Body:

None — the server uses the **current cart contents** as the source.

---

### 🔸 Response Format:

```json
{
  "orderId": 1001,
  "status": "pending",
  "createdAt": "2025-05-26T13:45:00Z",
  "total": 24.99
}
```

#### 🔸 Field Definitions:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`orderId`|integer|Unsigned integer|**yes**|Unique ID of the created order|
|`status`|string|Enum: `"pending"`|**yes**|Initial status of the order|
|`createdAt`|string|ISO 8601 datetime (UTC)|**yes**|Timestamp when order was created|
|`total`|float|2-digit precision|**yes**|Total cost of the placed order|

---

## 📘 **GET `/orders`**

### 🔸 Description:

Returns a list of the authenticated user’s past orders (most recent first).

---

### 🔸 Response Format:

```json
{
  "orders": [
    {
      "orderId": 1001,
      "createdAt": "2025-05-26T13:45:00Z",
      "total": 24.99,
      "status": "delivered"
    }
  ]
}
```

#### 🔸 Field Definitions:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`orders`|array|List of order summaries|**yes**|User’s past orders, most recent first|
|`orderId`|integer|Unsigned integer|**yes**|Unique ID of the order|
|`createdAt`|string|ISO 8601 datetime (UTC)|**yes**|When the order was placed|
|`total`|float|2-digit precision|**yes**|Total price of that order|
|`status`|string|`"pending"` / `"delivered"`|**yes**|Current status of the order|

---

## 📘 **GET `/orders/:id`**

### 🔸 Description:

Fetch full details for a specific order placed by the current user.

---

### 🔸 Response Format:

```json
{
  "orderId": 1001,
  "createdAt": "2025-05-26T13:45:00Z",
  "status": "delivered",
  "items": {
    "pizzas": [
      {
        "pizzaId": 1,
        "name": "Margherita",
        "quantity": 2,
        "unitPrice": 6.50,
        "totalPrice": 13.00,
        "size": 25
      }
    ],
    "extras": [
      {
        "itemId": 1,
        "type": "drink",
        "name": "Cola",
        "quantity": 1,
        "unitPrice": 2.00,
        "totalPrice": 2.00
      }
    ]
  },
  "total": 15.00
}
```

#### 🔸 Field Definitions:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`orderId`|integer|Unsigned integer|**yes**|Unique order ID|
|`createdAt`|string|ISO 8601 datetime (UTC)|**yes**|Timestamp of the order|
|`status`|string|`"pending"` / `"delivered"`|**yes**|Current status of the order|
|`items`|object|Contains `pizzas` and `extras` arrays|**yes**|Items in the order|
|`pizzas`|array|List of pizza items|**yes**|Pizza entries in the order|
|`pizzaId`|integer|Unsigned integer|**yes**|ID of the pizza|
|`name`|string|UTF-8, max 64 chars|**yes**|Name of the pizza|
|`quantity`|integer|≥1|**yes**|Number of pizzas ordered|
|`unitPrice`|float|2-digit precision|**yes**|Price per pizza at time of order|
|`totalPrice`|float|2-digit precision|**yes**|`unitPrice × quantity`|
|`size`|integer|Valid pizza size value|**yes**|Size of the pizza (in cm)|
|`extras`|array|List of extra items|**yes**|Non-pizza items in the order|
|`itemId`|integer|Unsigned integer|**yes**|ID of the extra item|
|`type`|string|Lowercase identifier|**yes**|Category of extra (e.g., drink, sauce)|
|`name`|string|UTF-8|**yes**|Name of the extra item|
|`quantity`|integer|≥1|**yes**|Number of this extra item ordered|
|`unitPrice`|float|2-digit precision|**yes**|Price per extra unit at time of order|
|`totalPrice`|float|2-digit precision|**yes**|`unitPrice × quantity`|
|`total`|float|2-digit precision|**yes**|Final total of the entire order|

---

## 🔐 **POST `/auth/register`**

#### 🔸 Description:

Registers a new user and sends a verification email.

---

### 🔸 Request Body:

```json
{
  "email": "user@example.com",
  "password": "plaintextpassword"
}
```

#### 🔸 Field Definitions:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`email`|string|Valid email|**yes**|Email address to register|
|`password`|string|UTF-8 string, min 8 char|**yes**|Plaintext password (will be hashed)|

---

### 🔸 Response Format:

```json
{
  "message": "Registration successful. Please verify your email."
}
```

---

## 📨 **POST `/auth/resend-verification`**

#### 🔸 Description:

Resends the verification link to a registered, unverified email.

---

### 🔸 Request Body:

```json
{
  "email": "user@example.com"
}
```

#### 🔸 Field Definitions:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`email`|string|Valid email|**yes**|Email address to resend|

---

### 🔸 Response Format:

```json
{
  "message": "Verification email sent."
}
```

---

## ✅ **GET `/auth/verify-email`**

#### 🔸 Description:

Verifies a user's email address using the token sent to their inbox.

---

### 🔸 Query Parameters:

|Name|Type|Format|Required|Description|
|---|---|---|---|---|
|`token`|string|UUID or random|**yes**|Verification token from email link|

---

### 🔸 Response Format:

```json
{
  "message": "Email verified successfully."
}
```

---

## 🔐 **POST `/auth/login`**

#### 🔸 Description:

Logs in a verified user and returns an authentication token.

---

### 🔸 Request Body:

```json
{
  "email": "user@example.com",
  "password": "plaintextpassword"
}
```

#### 🔸 Field Definitions:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`email`|string|Valid email|**yes**|User's registered email|
|`password`|string|UTF-8 string, min 8 char|**yes**|User's password|

---

### 🔸 Response Format:

```json
{
  "user": {
    "id": 123,
    "email": "user@example.com"
  }
}
```

#### 🔸 Field Definitions:

|Field|Type|Format|Required|Description|
|---|---|---|---|---|
|`user.id`|integer|Unsigned integer|**yes**|Unique user ID|
|`user.email`|string|Valid email|**yes**|User email address|

---

## 🔒 **POST `/auth/logout`**

#### 🔸 Description:

Logs out a user by clearing session or invalidating token.

---

### 🔸 Response Format:

```json
{
  "message": "Logged out successfully."
}
```