import express from 'express';
import router from './routes/index.js';

const PORT = process.env.PORT || 5000;

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use('/', router);

app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});

export default app;