import { MongoClient } from 'mongodb';

class DBClient {
        constructor() {
                const host = process.env.DB_HOST || 'localhost';
                const port = process.env.DB_PORT || 27017;
                const database = process.env.DB_DATABASE || 'files_manager';

                const url = `mongodb://${host}:${port}`;

                this.client = new MongoClient(url);
                this._isConnected = false;
                this.db = null;
                this._connectionPromise = this.client.connect()
                        .then(() => {
                                this._isConnected = true;
                                this.db = this.client.db(database);
                        })
                        .catch((err) => {
                                this._isConnected = false;
                                console.error('MongoDB client connection failed:', err);
                        });
        }
        isAlive() {
                return this._isConnected;
        }

        async nbUsers() {
                await this._connectionPromise;
                const usersCollection = this.db.collection('users');
                return await usersCollection.countDocuments();
        }

        async nbFiles() {
                await this._connectionPromise;
                const filesCollection = this.db.collection('files');
                return await filesCollection.countDocuments();
        }
}

const dbClient = new DBClient();
export default dbClient;
