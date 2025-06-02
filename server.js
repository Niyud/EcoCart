/**
 * server.js
 * 
 * EcoCart Backend (Express + MongoDB + Groq AI Proxy)
 * 
 * - Loads environment variables from .env
 * - Serves static HTML/CSS/JS from project root
 * - Provides an AI proxy endpoint (/api/ask-ai) using Groq SDK
 * - Implements Products CRUD, Comments, Profile, Password Change, Login, Register
 * - Stores product images as Base64 data URIs in MongoDB (no disk writes)
 * - Dynamic PORT via process.env.PORT or default 3000
 * 
 * To run locally:
 * 1) Copy .env.example → .env, fill in MONGODB_URI and GROQ_API_KEY
 * 2) npm install
 * 3) npm start
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const { MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');
const fs = require('fs');
const dotenv = require('dotenv');
const Groq = require('groq-sdk').default;

// ────────────────────────────────────────────────────────────────────────────────
// 1) Load environment variables from .env
//    (Make sure you create a file named .env in your project root, based on .env.example)
// ────────────────────────────────────────────────────────────────────────────────
dotenv.config();

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set in .env');
  process.exit(1);
}
if (!GROQ_API_KEY) {
  console.error('❌ GROQ_API_KEY is not set in .env');
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────────────────
// 2) MongoDB client setup (shared connection)
// ────────────────────────────────────────────────────────────────────────────────
let cachedClient = null;
async function connectToDatabase() {
  if (cachedClient && cachedClient.isConnected()) {
    return cachedClient.db(); // return the same DB instance
  }
  const client = new MongoClient(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  await client.connect();
  cachedClient = client;
  return client.db();
}

// ────────────────────────────────────────────────────────────────────────────────
// 3) Initialize Groq client
// ────────────────────────────────────────────────────────────────────────────────
const groqClient = new Groq({ apiKey: GROQ_API_KEY });

// ────────────────────────────────────────────────────────────────────────────────
// 4) Express app setup
// ────────────────────────────────────────────────────────────────────────────────
const app = express();

// CORS (allow all origins by default)
app.use(cors());

// Parse incoming JSON bodies (for login/register, orders, AI proxy, etc.)
app.use(express.json());

// Serve static files (HTML/CSS/JS) from project root
app.use(express.static(__dirname));

// Serve images (profile & comment folders) via /images/*
app.use('/images', express.static(path.join(__dirname, 'images')));

// ────────────────────────────────────────────────────────────────────────────────
// 5) Multer setup for "ADD PRODUCT" (in-memory) → store as Base64
// ────────────────────────────────────────────────────────────────────────────────
const memoryStorage = multer.memoryStorage();
const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // max 5MB
});

// Ensure comments‐images folder exists (still used for user comments/images)
const COMMENTS_IMG_DIR = path.join(__dirname, 'images', 'comments');
if (!fs.existsSync(COMMENTS_IMG_DIR)) {
  fs.mkdirSync(COMMENTS_IMG_DIR, { recursive: true });
}
const commentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, COMMENTS_IMG_DIR);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${timestamp}-${file.fieldname}${ext}`);
  }
});
const commentUpload = multer({ storage: commentStorage });

// Ensure profile‐images folder exists
const PROFILE_IMG_DIR = path.join(__dirname, 'images', 'profiles');
if (!fs.existsSync(PROFILE_IMG_DIR)) {
  fs.mkdirSync(PROFILE_IMG_DIR, { recursive: true });
}
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, PROFILE_IMG_DIR);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${timestamp}-${file.fieldname}${ext}`);
  }
});
const profileUpload = multer({
  storage: profileStorage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 } // max 2MB
});

// ────────────────────────────────────────────────────────────────────────────────
// 6) Routes for serving HTML pages (unchanged from before)
// ────────────────────────────────────────────────────────────────────────────────
app.get('/',       (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login',  (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/profile',  (req, res) => res.sendFile(path.join(__dirname, 'profile.html')));
app.get('/cart',     (req, res) => res.sendFile(path.join(__dirname, 'cart.html')));
app.get('/wishlist', (req, res) => res.sendFile(path.join(__dirname, 'wishlist.html')));
app.get('/checkout', (req, res) => res.sendFile(path.join(__dirname, 'checkout.html')));
app.get('/about',    (req, res) => res.sendFile(path.join(__dirname, 'about.html')));
app.get('/order',    (req, res) => res.sendFile(path.join(__dirname, 'order.html')));
app.get('/security', (req, res) => res.sendFile(path.join(__dirname, 'security.html')));

// ────────────────────────────────────────────────────────────────────────────────
// 7) AI Proxy route using Groq JS SDK
//    (POST /api/ask-ai → { prompt: "..." })
// ────────────────────────────────────────────────────────────────────────────────
app.post('/api/ask-ai', async (req, res) => {
  const data = req.body;
  if (!data || typeof data.prompt !== 'string') {
    return res.status(400).json({ error: "Invalid payload. Expected JSON with a 'prompt' field." });
  }
  const promptText = data.prompt.trim();
  if (!promptText) {
    return res.status(400).json({ error: "Empty prompt provided." });
  }

  try {
    const response = await groqClient.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [{ role: "user", content: promptText }]
    });
    const assistantContent = response.choices[0].message.content.trim();
    return res.json({ response: assistantContent });
  } catch (err) {
    console.error("❌ Groq request failed:", err);
    return res.status(502).json({ error: `Groq request failed: ${err.message}` });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// 8) PRODUCTS CRUD
//    • GET /products      → return all products (fields: Name, ImageLink, Price, Rating, Category, _id)
//    • POST /add-product  → (multipart/form-data) { Name, Price, Rating, Category, image(file) }  
//                           → store new doc in collection "Economic_Items" with ImageLink = Base64 data URI
//    • DELETE /products/:id → delete by _id
// ────────────────────────────────────────────────────────────────────────────────

// GET all products
app.get('/products', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const collection = db.collection("Economic_Items");
    const products = await collection
      .find({}, { projection: { Name: 1, ImageLink: 1, Price: 1, Rating: 1, Category: 1 } })
      .toArray();
    console.log("📦 Products fetched:", products.map(p => p.Name));
    res.json(products);
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// POST: Add a new product (accepts <input type="file" name="image"> and other fields)
app.post(
  '/add-product',
  upload.single('image'),
  async (req, res) => {
    try {
      const { Name, Price, Rating, Category } = req.body;
      const imageFile = req.file; // Buffer in memory

      if (!Name || !Category || !Price) {
        return res.status(400).json({
          success: false,
          message: "All fields except Rating are required"
        });
      }
      if (!imageFile) {
        return res.status(400).json({
          success: false,
          message: "Product image file is required."
        });
      }

      // Validate price
      const priceNum = parseFloat(Price);
      if (isNaN(priceNum) || priceNum < 0) {
        return res.status(400).json({
          success: false,
          message: "Price must be a valid positive number"
        });
      }

      // Validate rating if provided
      let ratingNum = 5.0;
      if (Rating !== undefined && Rating !== null && Rating !== '') {
        ratingNum = parseFloat(Rating);
        if (isNaN(ratingNum) || ratingNum < 0 || ratingNum > 5) {
          return res.status(400).json({
            success: false,
            message: "Rating must be a number between 0 and 5"
          });
        }
      }

      // Convert file buffer → Base64 data URI
      const mimeType = imageFile.mimetype; // ex: "image/png"
      const base64Data = imageFile.buffer.toString('base64');
      const dataUri = `data:${mimeType};base64,${base64Data}`;

      // Insert into MongoDB
      const db = await connectToDatabase();
      const collection = db.collection("Economic_Items");
      await collection.insertOne({
        Name,
        Category,
        Price: priceNum,
        Rating: ratingNum,
        ImageLink: dataUri
      });

      console.log(`🆕 Product added: ${Name}`);
      return res.json({ success: true, message: "Product added successfully" });
    } catch (error) {
      console.error("❌ Error adding product:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to add product"
      });
    }
  }
);

// DELETE: Remove a product by its MongoDB _id
app.delete('/products/:id', async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Invalid product ID" });
  }
  try {
    const db = await connectToDatabase();
    const collection = db.collection("Economic_Items");
    const result = await collection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    console.log(`🗑️  Product deleted: ${id}`);
    return res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting product:", error);
    return res.status(500).json({ success: false, message: "Failed to delete product" });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// 9) COMMENTS & RATINGS
//    • GET  /products/:id/comments      → fetch comments for a given productId
//    • POST /products/:id/comments      → add a comment + rating + optional image
//    • DELETE /products/:id/comments/:commentId → delete a comment + its image file
//    • PUT   /products/:id/comments/:commentId → update text/rating/image
// ────────────────────────────────────────────────────────────────────────────────

// GET all comments for a specific product
app.get('/products/:id/comments', async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Invalid product ID" });
  }
  try {
    const db = await connectToDatabase();
    const commentsCollection = db.collection("comments");
    const comments = await commentsCollection
      .find({ productId: new ObjectId(id) })
      .sort({ timestamp: -1 })
      .toArray();
    return res.json(comments);
  } catch (error) {
    console.error("❌ Error fetching comments:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch comments" });
  }
});

// POST a new comment + rating + optional image for a given product
app.post('/products/:id/comments', commentUpload.single('image'), async (req, res) => {
  const { id } = req.params;
  const { comment, rating } = req.body;
  const imageFile = req.file; // multer processed

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Invalid product ID" });
  }
  if (!comment || typeof comment !== 'string' || comment.trim() === "") {
    return res.status(400).json({ success: false, message: "Comment is required" });
  }
  const ratingNum = parseInt(rating);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ success: false, message: "Rating must be between 1 and 5" });
  }

  try {
    const db = await connectToDatabase();
    const commentsCollection = db.collection("comments");
    const newComment = {
      productId: new ObjectId(id),
      comment: comment.trim(),
      rating: ratingNum,
      timestamp: new Date(),
      imageUrl: imageFile
        ? `/images/comments/${encodeURIComponent(imageFile.filename)}`
        : null
    };
    await commentsCollection.insertOne(newComment);
    return res.json({ success: true, message: "Comment added successfully" });
  } catch (error) {
    console.error("❌ Error adding comment:", error);
    return res.status(500).json({ success: false, message: "Failed to add comment" });
  }
});

// DELETE a comment by its commentId (and delete its image file if present)
app.delete('/products/:id/comments/:commentId', async (req, res) => {
  const { id, commentId } = req.params;
  if (!ObjectId.isValid(id) || !ObjectId.isValid(commentId)) {
    return res.status(400).json({ success: false, message: "Invalid IDs" });
  }
  try {
    const db = await connectToDatabase();
    const commentsCollection = db.collection("comments");
    const existing = await commentsCollection.findOne({ _id: new ObjectId(commentId) });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }
    if (existing.imageUrl) {
      const filepath = path.join(__dirname, existing.imageUrl);
      fs.unlink(filepath, err => {
        if (err && err.code !== 'ENOENT') {
          console.error("❌ Error deleting comment image file:", err);
        }
      });
    }
    const result = await commentsCollection.deleteOne({ _id: new ObjectId(commentId) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }
    return res.json({ success: true, message: "Comment deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting comment:", error);
    return res.status(500).json({ success: false, message: "Failed to delete comment" });
  }
});

// PUT (update) a comment by its commentId (allow updating text, rating, and optionally replace image)
app.put('/products/:id/comments/:commentId', commentUpload.single('image'), async (req, res) => {
  const { id, commentId } = req.params;
  const { comment, rating } = req.body;
  const imageFile = req.file; // multer processed

  if (!ObjectId.isValid(id) || !ObjectId.isValid(commentId)) {
    return res.status(400).json({ success: false, message: "Invalid IDs" });
  }
  if (!comment || typeof comment !== 'string' || comment.trim() === "") {
    return res.status(400).json({ success: false, message: "Comment is required" });
  }
  const ratingNum = parseInt(rating);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ success: false, message: "Rating must be between 1 and 5" });
  }

  try {
    const db = await connectToDatabase();
    const commentsCollection = db.collection("comments");
    const existing = await commentsCollection.findOne({ _id: new ObjectId(commentId) });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    // If a new image was uploaded, delete the old file if it exists
    if (imageFile && existing.imageUrl) {
      const oldFile = path.join(__dirname, existing.imageUrl);
      fs.unlink(oldFile, err => {
        if (err && err.code !== 'ENOENT') {
          console.error("❌ Error deleting old comment image file:", err);
        }
      });
    }

    // Build the update object
    const updatedFields = {
      comment: comment.trim(),
      rating: ratingNum,
      timestamp: new Date()
    };
    if (imageFile) {
      updatedFields.imageUrl = `/images/comments/${encodeURIComponent(imageFile.filename)}`;
    }

    await commentsCollection.updateOne(
      { _id: new ObjectId(commentId) },
      { $set: updatedFields }
    );
    return res.json({ success: true, message: "Comment updated successfully" });
  } catch (error) {
    console.error("❌ Error updating comment:", error);
    return res.status(500).json({ success: false, message: "Failed to update comment" });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// 10) PROFILE UPDATE
//     • POST /update_profile  → update user fields & optional profile image
// ────────────────────────────────────────────────────────────────────────────────
app.post('/update_profile', profileUpload.single('profileImage'), async (req, res) => {
  const { email, name, username, pronouns, bio, links, gender, phone, address } = req.body;
  const imageFile = req.file;

  if (!email || !name || !username || !pronouns) {
    return res.status(400).json({ success: false, message: "Email, name, username, and pronouns are required" });
  }

  try {
    const db = await connectToDatabase();
    const users = db.collection("users");
    const existingUser = await users.findOne({ email });
    if (!existingUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Handle profile image
    let newImageUrl = existingUser.profileImageUrl || null;
    if (imageFile) {
      if (existingUser.profileImageUrl) {
        const oldPath = path.join(__dirname, existingUser.profileImageUrl);
        fs.unlink(oldPath, err => {
          if (err && err.code !== 'ENOENT') {
            console.error("❌ Error deleting old profile image:", err);
          }
        });
      }
      newImageUrl = `/images/profiles/${encodeURIComponent(imageFile.filename)}`;
    }

    const updateFields = {
      name,
      username,
      pronouns,
      bio: bio || "",
      links: links || "",
      gender: gender || "",
      phone: phone || "",
      address: address || ""
    };
    if (newImageUrl) {
      updateFields.profileImageUrl = newImageUrl;
    }
    await users.updateOne(
      { email },
      { $set: updateFields },
      { upsert: false }
    );
    return res.json({ success: true, message: "Profile updated successfully", profileImageUrl: newImageUrl });
  } catch (error) {
    console.error("❌ Error updating profile:", error);
    return res.status(500).json({ success: false, message: "Profile update failed" });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// 11) CHANGE PASSWORD (email + newPassword only—no current password check)
//     • POST /change_password → { email, newPassword }
// ────────────────────────────────────────────────────────────────────────────────
app.post('/change_password', async (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    return res.status(400).json({ success: false, message: "Email and new password are required" });
  }

  try {
    const db = await connectToDatabase();
    const users = db.collection("users");
    const user = await users.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters long" });
    }
    const hashedNew = await bcrypt.hash(newPassword, 10);
    await users.updateOne(
      { email },
      { $set: { password: hashedNew } }
    );
    return res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("❌ Error changing password:", error);
    return res.status(500).json({ success: false, message: "Failed to change password" });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// 12) ORDERS & USERS (unchanged)
//     • POST /api/orders     → save checkout order
//     • POST /login          → authenticate user
//     • POST /register       → register new user
// ────────────────────────────────────────────────────────────────────────────────

// POST: Save checkout order to MongoDB
app.post('/api/orders', async (req, res) => {
  try {
    const { fullName, address, city, postalCode, cart, total, timestamp } = req.body;
    if (!fullName || !address || !city || !postalCode || !cart || cart.length === 0 || !total || !timestamp) {
      return res.status(400).json({ message: "Missing required order fields" });
    }
    const db = await connectToDatabase();
    const result = await db.collection("orders").insertOne({
      fullName,
      address,
      city,
      postalCode,
      cart,
      total,
      timestamp
    });
    console.log(`✅ Order stored with ID: ${result.insertedId}`);
    return res.status(201).json({ message: "Order saved successfully", orderId: result.insertedId });
  } catch (error) {
    console.error("❌ Error saving order:", error);
    return res.status(500).json({ message: "Failed to save order" });
  }
});

// POST: Login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }
    const db = await connectToDatabase();
    const users = db.collection("users");
    const user = await users.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    const { password: _, ...userData } = user;
    return res.json({ success: true, user: userData });
  } catch (error) {
    console.error("❌ Login error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// POST: Register
app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ success: false, message: "Name, email and password are required" });
    }
    const db = await connectToDatabase();
    const users = db.collection("users");
    const existing = await users.findOne({ email });
    if (existing) {
      return res.status(409).json({ success: false, message: "User already exists" });
    }
    const hashed = await bcrypt.hash(password, 10);
    await users.insertOne({
      email,
      password: hashed,
      name,
      phone: "",
      address: "",
      username: "",
      pronouns: "",
      bio: "",
      links: "",
      gender: "",
      profileImageUrl: ""
    });
    console.log(`🟢 New user registered: ${email}`);
    return res.json({ success: true, message: "User registered successfully" });
  } catch (error) {
    console.error("❌ Registration error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// 13) Start the server
// ────────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log("📁 Static files served from:", __dirname);
  console.log("🖼️  Images served from /images/");
});
