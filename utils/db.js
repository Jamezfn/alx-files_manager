class DBClient {
	constructor() {
		const host = process.argv.DB_HOST || 'localhost';
		const port = process.argv.DB_PORT || 27017;
		const database = process.env.DB_DATABASE || 'files_manager';

		const url = `mongodb://${host}:${port}`;

		this.client = new MongoClient(url, {
			useNewUrlParser: true,
			useUnifiedTopology: true
		});
	}
}
