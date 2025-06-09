### 📄 1. **List All Pizzas**
```JS
fetch('https://example.com/api/v1/pizzas')
  .then(res => res.json())
  .then(data => {
    console.log(data);
    // Example response:
    // {
    //   "total": 125,
    //   "limit": 20,
    //   "offset": 0,
    //   "results": [
    //     {
    //       "id": 1,
    //       "name": "Margherita",
    //       "tags": ["vegetarian"],
    //       "price": 6.50
    //     },
    //     ...
    //   ]
    // }
  });
```
### 🔍 2. **Search Pizzas by Tags**
```JS
const tags = ['spicy', 'vegan']; // must be lowercase
const url = `https://example.com/api/v1/pizzas?tags=${tags.join(',')}`;

fetch(url)
  .then(res => res.json())
  .then(data => {
    console.log(data);
    // Same structure as above, but filtered results
  });
```
### 🔄 3. **Paginate Pizza Results**
```JS
const limit = 10;
const offset = 20; // skip first 20 pizzas (page 3 if 10 per page)

fetch(`https://example.com/api/v1/pizzas?limit=${limit}&offset=${offset}`)
  .then(res => res.json())
  .then(data => {
    console.log(data);
    // {
    //   "total": 125,
    //   "limit": 10,
    //   "offset": 20,
    //   "results": [ ... ]
    // }
  });
```
### 🧾 4. **Get Pizza Details by ID**
```JS
const pizzaId = 42;

fetch(`https://example.com/api/v1/pizzas/${pizzaId}`)
  .then(res => res.json())
  .then(data => {
    console.log(data);
    // {
    //   "id": 42,
    //   "name": "Spicy Vegan Deluxe",
    //   "ingredients": ["tomato", "jalapeños", "vegan cheese"],
    //   "tags": ["spicy", "vegan"],
    //   "price": 9.99
    // }
  });
```

## Cart
### 📘 1. Get current cart

  

``` JSON
// 🛒 Get all items in current cart
fetch("https://example.com/api/v1/cart", {
	method: "GET",
	headers: {
		"Accept": "application/json"
	}
})
.then(res => res.json())
.then(data => {
	console.log(data);
	// 💡 Example response:
	// {
	// "items": [
	//         {
	//             "pizzaId": 1,
	//             "name": "Margherita",
	//             "quantity": 2,
	//             "unitPrice": 6.50,
	//             "totalPrice": 13.00
	//         }
	//     ],
	//     "total": 13.00
	// }
});
```
  
### 📘 2. Add or update item in cart
  
```JSON
// ➕ Add or update a pizza in the cart
fetch("https://example.com/api/v1/cart", {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		"Accept": "application/json",
	},
	body: JSON.stringify({
		pizzaId: 1, // 🍕 Pizza ID (unsigned integer)
		quantity: 2 // 🔢 Quantity (0 to remove, >0 to set/update)
	})
});
```
  
### 📘 3. Remove item from cart
  
```JSON
// ❌ Remove a pizza from cart by ID
const pizzaId = 1;
fetch(`https://example.com/api/v1/cart/${pizzaId}`, {
	method: "DELETE"
});
```
  
### 📘 4. Clear the entire cart
  
```JSON
// 🧹 Remove all items from the cart
fetch("https://example.com/api/v1/cart", {
	method: "DELETE"
});
```

---
## Orders

### 📘 1. **Place an Order (`POST /orders`)**

```js
fetch("https://example.com/api/v1/orders", {
  method: "POST",
  headers: {
    "Accept": "application/json"
  }
})
  .then(res => res.json())
  .then(data => {
    console.log(data);
    // {
    //   "orderId": 1001,
    //   "status": "pending",
    //   "createdAt": "2025-05-26T13:45:00Z",
    //   "total": 24.99
    // }
  });
```

---

### 📘 2. **List Past Orders (`GET /orders`)**

```js
fetch("https://example.com/api/v1/orders", {
  method: "GET",
  headers: {
    "Accept": "application/json"
  }
})
  .then(res => res.json())
  .then(data => {
    console.log(data);
    // {
    //   "orders": [
    //     {
    //       "orderId": 1001,
    //       "createdAt": "2025-05-26T13:45:00Z",
    //       "total": 24.99,
    //       "status": "delivered"
    //     }
    //   ]
    // }
  });
```

---

### 📘 3. **Get Specific Order (`GET /orders/:id`)**

```js
fetch("https://example.com/api/v1/orders/1001", {
  method: "GET",
  headers: {
    "Accept": "application/json"
  }
})
  .then(res => res.json())
  .then(data => {
    console.log(data);
    // {
    //   "orderId": 1001,
    //   "createdAt": "2025-05-26T13:45:00Z",
    //   "status": "delivered",
    //   "items": [
    //     {
    //       "pizzaId": 1,
    //       "name": "Margherita",
    //       "quantity": 2,
    //       "unitPrice": 6.50,
    //       "totalPrice": 13.00
    //     }
    //   ],
    //   "total": 24.99
    // }
  });
```