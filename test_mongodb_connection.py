"""
MongoDB Atlas Connection & Verification Test Script
Tests Atlas connectivity, database existence, collections, indexes, and basic CRUD operations.
"""

import sys
import io

# Ensure UTF-8 output encoding on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from pymongo import MongoClient
from Backend.app.config import settings
from Backend.app.database import get_database, init_db

def test_connection():
    print("=" * 60)
    print("MongoDB Atlas Connection Verification Test")
    print("=" * 60)

    uri = settings.MONGODB_URI
    db_name = settings.MONGODB_DATABASE or "ai_interview_db"

    if not uri:
        print("\n[ERROR] MONGODB_URI is not set in .env!")
        print("Please configure MONGODB_URI in your .env file with your Atlas connection string.")
        return False

    print(f"\nTarget Database: {db_name}")
    print("Attempting to connect to MongoDB Atlas...")

    try:
        db = get_database()
        # Ping
        res = db.client.admin.command("ping")
        print(f"  [OK] Ping response: {res}")

        # Initialize indexes
        print("\nVerifying and creating indexes...")
        indexed = init_db()
        if indexed:
            print("  [OK] Indexes verified on all collections.")
        else:
            print("  [WARN] Index initialization returned warnings.")

        # Check collections
        existing_cols = db.list_collection_names()
        print(f"\nExisting collections in '{db_name}': {existing_cols}")

        required_collections = ["users", "candidates", "interviews", "feedback", "reports"]
        for col in required_collections:
            count = db[col].count_documents({})
            indexes = list(db[col].list_indexes())
            index_names = [idx.get("name") for idx in indexes]
            print(f"  - Collection '{col}': {count} documents, indexes: {index_names}")

        # Test basic write/read
        print("\nTesting write/read capability...")
        test_col = db["_connection_test"]
        insert_res = test_col.insert_one({"test": "atlas_connection", "status": "ok"})
        doc = test_col.find_one({"_id": insert_res.inserted_id})
        assert doc is not None and doc.get("test") == "atlas_connection"
        test_col.delete_one({"_id": insert_res.inserted_id})
        print("  [OK] Temporary document written, read, and cleaned up successfully.")

        print("\n[SUCCESS] MongoDB Atlas cluster is fully connected and ready!")
        return True

    except Exception as e:
        import re
        sanitized_err = re.sub(r':([^@/:]+)@', ':****@', str(e))
        print(f"\n[FAIL] MongoDB Atlas connection test failed: {sanitized_err}")
        return False

if __name__ == "__main__":
    success = test_connection()
    sys.exit(0 if success else 1)

