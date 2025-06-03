// script.js
// Main script to fetch, display, filter, sort, and handle UI interactions for Eco-Cart
// Date: 29/05/2025, created by: Nicholas, Student ID: 11890355

let products = [];

// Fetch products from the backend API
async function fetchProducts() {
  try {
    // ▶︎ Changed from hard-coded localhost to a relative path
    const response = await fetch("/products");
    if (!response.ok) throw new Error("❌ Failed to fetch data");

    products = await response.json();
    filterProducts();
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    document.getElementById("products").innerHTML = "<p>⚠️ Failed to load products.</p>";
  }
}

// Function to display products on index.html
function displayProducts(productList) {
  const productsContainer = document.getElementById("products");
  productsContainer.innerHTML = "";

  if (productList.length === 0) {
    productsContainer.innerHTML = "<p>No products found.</p>";
    return;
  }

  productList.forEach(product => {
    const productCard = document.createElement("div");
    productCard.classList.add("card");

    // Build the inner HTML for each product card, including View Product button
    productCard.innerHTML = `
      <img src="${product.ImageLink}" alt="${product.Name}" />
      <h3>${product.Name}</h3>
      <p style="color: #fbc02d; font-weight: bold;">${product.Category}</p>
      <p class="price">$${product.Price}</p>
      <p class="rating">Rating: ${product.Rating} ⭐</p>
      <button onclick='addToCart(${JSON.stringify({
        name: product.Name,
        price: product.Price,
        image: product.ImageLink,
        qty: 1
      })})'>Add to Cart</button>
      <button onclick='addToWishlist(${JSON.stringify({
        name: product.Name,
        price: product.Price,
        image: product.ImageLink,
        qty: 1
      })})' style="margin-top:8px; background-color:#fbc02d; border:none; padding:10px; border-radius:5px; cursor:pointer; width:100%; font-weight:600;">
        Add to Wishlist
      </button>
      <button onclick='viewProduct(${JSON.stringify(product)})' style="margin-top:8px; background-color:#2196f3; color:white; border:none; padding:10px; border-radius:5px; cursor:pointer; width:100%; font-weight:600;">
        View Product
      </button>
    `;

    productsContainer.appendChild(productCard);
  });
}

// 🛒 Add to Cart Function
function addToCart(product) {
  let cart = JSON.parse(localStorage.getItem("cart")) || [];
  const existing = cart.find(item => item.name === product.name);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push(product);
  }
  localStorage.setItem("cart", JSON.stringify(cart));
  updateCartDisplay();
}

// 💖 Add to Wishlist Function
function addToWishlist(product) {
  let wishlist = JSON.parse(localStorage.getItem("wishlist")) || [];
  const existing = wishlist.find(item => item.name === product.name);
  if (existing) {
    alert(`${product.name} is already in your wishlist!`);
  } else {
    wishlist.push(product);
    localStorage.setItem("wishlist", JSON.stringify(wishlist));
    alert(`${product.name} added to wishlist!`);
  }
}

// 🔁 Redirecting View Product Function
function viewProduct(product) {
  // Store the entire product object in localStorage for product.html
  localStorage.setItem("selectedProduct", JSON.stringify(product));
  // Redirect to product.html
  window.location.href = "product.html";
}

// Function to update cart display (for cart.html)
function updateCartDisplay() {
  let cart = JSON.parse(localStorage.getItem("cart")) || [];
  const cartContainer = document.getElementById("cart-body");
  if (!cartContainer) return; // If you're not on cart.html, exit
  cartContainer.innerHTML = "";

  let total = 0;
  cart.forEach((item, index) => {
    total += item.price * item.qty;
    let row = `
      <tr>
        <td>${item.name}</td>
        <td>
          <button onclick="changeQuantity(${index}, -1)">➖</button>
          <span>${item.qty}</span>
          <button onclick="changeQuantity(${index}, 1)">➕</button>
        </td>
        <td>$${item.price}</td>
        <td>$${(item.price * item.qty).toFixed(2)}</td>
        <td><button onclick="removeItem(${index})">❌</button></td>
      </tr>`;
    cartContainer.innerHTML += row;
  });

  const totalPriceElem = document.getElementById("total-price");
  if (totalPriceElem) {
    totalPriceElem.textContent = `$${total.toFixed(2)}`;
  }
}

function changeQuantity(index, change) {
  let cart = JSON.parse(localStorage.getItem("cart")) || [];
  if (cart[index]) {
    cart[index].qty += change;
    if (cart[index].qty <= 0) {
      cart.splice(index, 1);
    }
  }
  localStorage.setItem("cart", JSON.stringify(cart));
  updateCartDisplay();
}

function removeItem(index) {
  let cart = JSON.parse(localStorage.getItem("cart")) || [];
  cart.splice(index, 1);
  localStorage.setItem("cart", JSON.stringify(cart));
  updateCartDisplay();
}

// Filtering and sorting logic
function filterByCategory(categoryName) {
  document.getElementById("category-filter").value = categoryName;
  filterProducts();
}

function filterProducts() {
  const searchInput = document.getElementById("search")?.value.toLowerCase() || "";
  const categoryFilter = document.getElementById("category-filter")?.value;
  const priceFilter = document.getElementById("price-filter")?.value;
  const sortOption = document.getElementById("sort-filter")?.value;

  if (!products || products.length === 0) return;

  let filteredProducts = products.filter(product => {
    const nameMatch = product.Name.toLowerCase().includes(searchInput);
    const categoryMatch = categoryFilter ? product.Category === categoryFilter : true;

    let priceMatch = true;
    if (priceFilter) {
      const [min, max] = priceFilter.split("-").map(Number);
      priceMatch = product.Price >= min && product.Price <= max;
    }

    return nameMatch && categoryMatch && priceMatch;
  });

  if (sortOption === "price-asc") {
    filteredProducts.sort((a, b) => a.Price - b.Price);
  } else if (sortOption === "price-desc") {
    filteredProducts.sort((a, b) => b.Price - a.Price);
  } else if (sortOption === "rating-desc") {
    filteredProducts.sort((a, b) => b.Rating - a.Rating);
  }

  displayProducts(filteredProducts);
}

// Initial event listeners for index.html
document.addEventListener("DOMContentLoaded", () => {
  // Determine which page we're on by checking for specific elements
  const productsSection = document.getElementById("products");
  const cartBody = document.getElementById("cart-body");
  const productDetailContainer = document.getElementById("product-detail"); // container in product.html

  // INDEX.HTML: If the products container exists, fetch & display products
  if (productsSection) {
    fetchProducts();
    document.getElementById("search").addEventListener("input", filterProducts);
    document.getElementById("category-filter").addEventListener("change", filterProducts);
    document.getElementById("price-filter").addEventListener("change", filterProducts);
    document.getElementById("sort-filter").addEventListener("change", filterProducts);
  }

  // CART.HTML: If the cart table body exists, update cart display
  if (cartBody) {
    updateCartDisplay();
  }

  // PRODUCT.HTML: If the product-detail container exists, render selected product
  if (productDetailContainer) {
    renderSelectedProduct();
  }

  // Authentication button logic (shared across index.html / any page with login/logout)
  const authButtons = document.getElementById("auth-buttons");
  const userIcon = document.getElementById("user-icon");
  const isLoggedIn = !!localStorage.getItem("user");

  if (authButtons && userIcon) {
    if (isLoggedIn) {
      authButtons.style.display = "none";
      userIcon.style.display = "block";
    } else {
      authButtons.style.display = "flex";
      userIcon.style.display = "none";
    }
  }
});

// PRODUCT.HTML: Render the product details on product.html
function renderSelectedProduct() {
  const productJSON = localStorage.getItem("selectedProduct");
  if (!productJSON) return;

  const product = JSON.parse(productJSON);
  // Assume product.html has the following HTML structure (IDs must match):
  // <div id="product-detail">
  //   <img id="product-image" src="" alt="Product Image" />
  //   <h1 id="product-name"></h1>
  //   <p id="product-category"></p>
  //   <p id="product-price"></p>
  //   <p id="product-rating"></p>
  //   <p id="product-description"></p>
  //   <div>
  //     <label for="qty-input">Quantity:</label>
  //     <input type="number" id="qty-input" value="1" min="1" />
  //   </div>
  //   <p>Total: $<span id="total-price"></span></p>
  //   <button id="add-to-cart-btn">Add to Cart</button>
  //   <button id="add-to-wishlist-btn">Add to Wishlist</button>
  // </div>

  // Populate each field
  const imgElem = document.getElementById("product-image");
  const nameElem = document.getElementById("product-name");
  const categoryElem = document.getElementById("product-category");
  const priceElem = document.getElementById("product-price");
  const ratingElem = document.getElementById("product-rating");
  const descElem = document.getElementById("product-description");
  const qtyInput = document.getElementById("qty-input");
  const totalSpan = document.getElementById("total-price");
  const addToCartBtn = document.getElementById("add-to-cart-btn");
  const addToWishlistBtn = document.getElementById("add-to-wishlist-btn");

  if (imgElem) imgElem.src = product.ImageLink;
  if (nameElem) nameElem.textContent = product.Name;
  if (categoryElem) categoryElem.textContent = `Category: ${product.Category}`;
  if (priceElem) priceElem.textContent = `Price: $${product.Price}`;
  if (ratingElem) ratingElem.textContent = `Rating: ${product.Rating} ⭐`;
  if (descElem) descElem.textContent = product.Description || "No description available.";

  // Initialize total price
  if (qtyInput && totalSpan) {
    totalSpan.textContent = (product.Price * parseInt(qtyInput.value || 1)).toFixed(2);

    // Update total when quantity changes
    qtyInput.addEventListener("input", () => {
      const qty = parseInt(qtyInput.value) || 1;
      totalSpan.textContent = (product.Price * qty).toFixed(2);
    });
  }

  // Add to Cart from product.html
  if (addToCartBtn) {
    addToCartBtn.addEventListener("click", () => {
      const qty = parseInt(qtyInput.value) || 1;
      addToCart({
        name: product.Name,
        price: product.Price,
        image: product.ImageLink,
        qty: qty
      });
      alert(`${product.Name} (x${qty}) added to cart!`);
    });
  }

  // Add to Wishlist from product.html
  if (addToWishlistBtn) {
    addToWishlistBtn.addEventListener("click", () => {
      addToWishlist({
        name: product.Name,
        price: product.Price,
        image: product.ImageLink,
        qty: 1
      });
    });
  }
}

// Toggle user menu dropdown
function toggleUserMenu() {
  const menu = document.getElementById("user-menu");
  if (menu) {
    menu.style.display = menu.style.display === "block" ? "none" : "block";
  }
}

// Logout user
function logoutUser() {
  localStorage.removeItem("user");
  alert("You have been logged out.");
  window.location.reload();
}
