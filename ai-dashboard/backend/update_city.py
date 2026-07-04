import sqlite3

def main():
    conn = sqlite3.connect("chat_history.db")
    # Update default values and all current rows
    conn.execute("UPDATE user_settings SET favorite_city = 'Greater Noida'")
    conn.commit()
    conn.close()
    print("Database updated favorite_city to Greater Noida.")

if __name__ == "__main__":
    main()
