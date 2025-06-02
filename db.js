const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("❌ MONGODB_URI environment variable is not set!");
  process.exit(1);
}

const client = new MongoClient(uri);

let dbInstance = null;

async function connectToDatabase() {
  if (dbInstance) {
    // Return existing connection if available
    return dbInstance;
  }

  try {
    await client.connect();
    console.log("✅ Successfully connected to MongoDB!");
    dbInstance = client.db("Eco-Items"); // your database name
    return dbInstance;
  } catch (error) {
    console.error("❌ Connection failed:", error);
    return null; // return null or throw error to the caller
  }
}

// Export the function
module.exports = connectToDatabase;