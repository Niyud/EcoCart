require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const { MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');
const fs = require('fs');
const connectToDatabase = require('./db');

// ──────────────────────────────────────────────────────────────────────────
// ADDED: Import Groq for AI proxy (use .default to get the constructor)
// ──────────────────────────────────────────────────────────────────────────
const Groq = require('groq-sdk').default;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY not set in environment");
}
const groqClient = new Groq({ apiKey: GROQ_API_KEY });
// ──────────────────────────────────────────────────────────────────────────

const app = express();
const PORT = 3000;

/* ─────────────────────────────────────────────────────────────────────
   ** NEW: Use Multer in “memory” mode so we can convert the file buffer 
   into a Base64 data‐URI and store it directly in MongoDB. **

   - We do NOT write anything to disk.
   - upload.single('image') will pick up the <input name="image" …> from order.html.
   - After that, req.file.buffer holds the raw bytes. We turn those into a data URI.
   ───────────────────────────────────────────────────────────────────── */
const memoryStorage = multer.memoryStorage();
const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // max 5MB
});

/* ─────────────────────────────────────────────────────────────────────
   ENSURE THE COMMENTS‐IMAGES FOLDER EXISTS
   ───────────────────────────────────────────────────────────────────── */
const COMMENTS_IMG_DIR = path.join(__dirname, 'images', 'comments');
if (!fs.existsSync(COMMENTS_IMG_DIR)) {
  fs.mkdirSync(COMMENTS_IMG_DIR, { recursive: true });
}

// Multer setup for handling comment images (unchanged)
const commentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, COMMENTS_IMG_DIR);
  },
  filename: (req, file, cb) => {
    // e.g. 1654012345678-image.jpg
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${timestamp}-${file.fieldname}${ext}`);
  }
});
const commentUpload = multer({ storage: commentStorage });

// Ensure the profile‐images folder exists
const PROFILE_IMG_DIR = path.join(__dirname, 'images', 'profiles');
if (!fs.existsSync(PROFILE_IMG_DIR)) {
  fs.mkdirSync(PROFILE_IMG_DIR, { recursive: true });
}

// Multer setup for handling profile images (unchanged)
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

app.use(cors());
app.use(express.json());

// Serve static files (HTML, CSS, JS)
app.use(express.static(__dirname));

// Serve images (including comment & profile images) via /images → __dirname/images
app.use('/images', express.static(path.join(__dirname, 'images')));

// Serve HTML pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'profile.html')));
app.get('/cart', (req, res) => res.sendFile(path.join(__dirname, 'cart.html')));
app.get('/wishlist', (req, res) => res.sendFile(path.join(__dirname, 'wishlist.html')));
app.get('/checkout', (req, res) => res.sendFile(path.join(__dirname, 'checkout.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'about.html')));
app.get('/order', (req, res) => res.sendFile(path.join(__dirname, 'order.html')));
app.get('/security', (req, res) => res.sendFile(path.join(__dirname, 'security.html')));

// ──────────────────────────────────────────────────────────────────────────
// ADDED: AI Proxy route using Groq JS SDK (unchanged from before)
// ──────────────────────────────────────────────────────────────────────────
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
// ──────────────────────────────────────────────────────────────────────────

// ---------------------- PRODUCTS CRUD ----------------------

// GET all products (each doc includes _id)
app.get('/products', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const collection = db.collection("Economic_Items");

    // Project only the fields you need; _id is included automatically
    const products = await collection.find({}, {
      projection: { Name: 1, ImageLink: 1, Price: 1, Rating: 1, Category: 1 }
    }).toArray();

    console.log("📦 Products fetched:", products.map(p => p.Name));
    res.json(products);
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// MODIFIED: POST: Add a new product (now accepts a file “image” and stores a Base64 data URI in MongoDB)
// ──────────────────────────────────────────────────────────────────────────
app.post(
  '/add-product',
  upload.single('image'), // ← THIS is the crucial Multer middleware for file 
  async (req, res) => {
    try {
      // Extract text fields from the multipart/form-data body
      const { Name, Price, Rating, Category } = req.body;
      const imageFile = req.file; // Multer placed the file buffer here

      // Original validation: Name, Category, Price must all be present
      if (!Name || !Category || !Price) {
        return res.status(400).json({
          success: false,
          message: "All fields except Rating are required"
        });
      }

      // If no file arrived, error out
      if (!imageFile) {
        return res.status(400).json({
          success: false,
          message: "Product image file is required."
        });
      }

      // Validate Price is a valid positive number
      const priceNum = parseFloat(Price);
      if (isNaN(priceNum) || priceNum < 0) {
        return res.status(400).json({
          success: false,
          message: "Price must be a valid positive number"
        });
      }

      // Validate Rating if provided; otherwise default to 5.0
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

      // Convert the in-memory file buffer into a base64 data URI:
      // e.g. "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgA..."
      const mimeType = imageFile.mimetype; // e.g. "image/png"
      const base64Data = imageFile.buffer.toString('base64');
      const dataUri = `data:${mimeType};base64,${base64Data}`;

      // Insert into MongoDB, storing dataUri under ImageLink
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
    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting product:", error);
    res.status(500).json({ success: false, message: "Failed to delete product" });
  }
});

// ---------------------- COMMENTS & RATINGS ----------------------

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

    res.json(comments);
  } catch (error) {
    console.error("❌ Error fetching comments:", error);
    res.status(500).json({ success: false, message: "Failed to fetch comments" });
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

    // Construct the new comment document
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
    res.json({ success: true, message: "Comment added successfully" });
  } catch (error) {
    console.error("❌ Error adding comment:", error);
    res.status(500).json({ success: false, message: "Failed to add comment" });
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

    // First find the comment to retrieve its imageUrl
    const existing = await commentsCollection.findOne({ _id: new ObjectId(commentId) });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    // Delete the image file from disk if it exists
    if (existing.imageUrl) {
      const filepath = path.join(__dirname, existing.imageUrl);
      fs.unlink(filepath, err => {
        if (err && err.code !== 'ENOENT') {
          console.error("❌ Error deleting comment image file:", err);
        }
      });
    }

    // Remove the comment document
    const result = await commentsCollection.deleteOne({ _id: new ObjectId(commentId) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    res.json({ success: true, message: "Comment deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting comment:", error);
    res.status(500).json({ success: false, message: "Failed to delete comment" });
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

    // Find the existing comment document
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

    // Perform the update
    await commentsCollection.updateOne(
      { _id: new ObjectId(commentId) },
      { $set: updatedFields }
    );

    res.json({ success: true, message: "Comment updated successfully" });
  } catch (error) {
    console.error("❌ Error updating comment:", error);
    res.status(500).json({ success: false, message: "Failed to update comment" });
  }
});

// ---------------------- PROFILE UPDATE ----------------------

// POST: Update Profile (with optional image upload)
app.post('/update_profile', profileUpload.single('profileImage'), async (req, res) => {
  const { email, name, username, pronouns, bio, links, gender, phone, address } = req.body;
  const imageFile = req.file;

  if (!email || !name || !username || !pronouns) {
    return res.status(400).json({ success: false, message: "Email, name, username, and pronouns are required" });
  }

  try {
    const db = await connectToDatabase();
    const users = db.collection("users");

    // Find existing user first
    const existingUser = await users.findOne({ email });
    if (!existingUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Handle profile image
    let newImageUrl = existingUser.profileImageUrl || null;
    if (imageFile) {
      // Delete old profile image if exists
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

    // Build update document
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

    // Update user in DB
    await users.updateOne(
      { email },
      { $set: updateFields },
      { upsert: false }
    );

    res.json({ success: true, message: "Profile updated successfully", profileImageUrl: newImageUrl });
  } catch (error) {
    console.error("❌ Error updating profile:", error);
    res.status(500).json({ success: false, message: "Profile update failed" });
  }
});

// ---------------------- CHANGE PASSWORD ----------------------

// POST: Change Password
app.post('/change_password', async (req, res) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword) {
    return res.status(400).json({ success: false, message: "Email and new password are required" });
  }

  try {
    const db = await connectToDatabase();
    const users = db.collection("users");

    // Find user by email
    const user = await users.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Validate new password strength
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters long" });
    }

    // Hash and update the new password
    const hashedNew = await bcrypt.hash(newPassword, 10);
    await users.updateOne(
      { email },
      { $set: { password: hashedNew } }
    );

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("❌ Error changing password:", error);
    res.status(500).json({ success: false, message: "Failed to change password" });
  }
});

// ---------------------- ORDERS & USERS (unchanged) ----------------------

// POST: Save checkout order to MongoDB (APPENDED ONLY — no overwrite)
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
    res.status(201).json({ message: "Order saved successfully", orderId: result.insertedId });
  } catch (error) {
    console.error("❌ Error saving order:", error);
    res.status(500).json({ message: "Failed to save order" });
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
    res.json({ success: true, user: userData });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
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
      email, password: hashed, name,
      phone: "", address: "",
      username: "", pronouns: "", bio: "", links: "", gender: "", profileImageUrl: ""
    });

    console.log(`🟢 New user registered: ${email}`);
    res.json({ success: true, message: "User registered successfully" });
  } catch (error) {
    console.error("❌ Registration error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// Start server
app.listen(process.env.PORT || PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://localhost:${process.env.PORT || PORT}`);
  console.log("📁 Static files served from:", __dirname);
  console.log("🖼️  Images served from /images/");
});

