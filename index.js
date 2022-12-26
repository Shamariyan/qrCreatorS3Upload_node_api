const express = require('express');
const { AwesomeQR } = require('awesome-qr');
const fs = require('fs');
const AWS = require('aws-sdk');
const axios = require('axios');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const sharp = require('sharp');

const app = express();

app.use(express.json());

const S3 = new AWS.S3({
	accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
});

app.get('/', (req, res) => res.send(`API running on ${PORT}`));

app.post('/', async (req, res, next) => {
	const uri = process.env.MONGO_URI;

	const client = new MongoClient(uri, {
		useNewUrlParser: true,
		useUnifiedTopology: true,
		serverApi: ServerApiVersion.v1,
	});

	const { orderId } = req.body;

	const rouletteUrl = `https://roulette-api.qr8code.com/roulette/${orderId}`;
	const background = fs.readFileSync('qrbg.jpg');

	const buffer = await new AwesomeQR({
		text: rouletteUrl,
		size: 565,
		backgroundImage: background,
		dotScale: 0.55,
	}).draw();

	let baseImageUrl = `https://d3rwni9jzymvdb.cloudfront.net/BaseImage.jpg`;
	const baseImage = await axios.get(baseImageUrl, {
		responseType: 'arraybuffer',
	});

	// Merging two images using sharp
	sharp(baseImage.data)
		.composite([
			{
				input: buffer,
				gravity: 'north',
				top: 90,
				left: 195,
			},
		])
		.toBuffer()
		.then((updatedBuffer) => {
			const params = {
				Bucket: process.env.BUCKET_NAME,
				Key: `${orderId}.png`,
				Body: updatedBuffer,
			};
			S3.upload(params, async (err, data) => {
				if (err) {
					return res.status(500).json({
						err,
					});
				}
				res.send('uploaded to S3');
				let cloudFrontUrl = `https://d3rwni9jzymvdb.cloudfront.net/${orderId}.png`;
				client.connect();

				const collection = client.db('qr8Code').collection('qr8_Collection');
				// Find the order details
				const response = await collection
					.find({
						_id: ObjectId(orderId),
					})
					.toArray();
				const { orderEmail, customerName } = response[0];
				const updateResponse = await collection.findOneAndUpdate(
					{
						_id: ObjectId(orderId),
					},

					{
						$set: {
							imageUrl: cloudFrontUrl,
							rouletteUrl,
						},
					}
				);
				//Calling email lambda function
				const body = {
					email: orderEmail,
					awsUrl: cloudFrontUrl,
					name: customerName,
					orderId: orderId,
					rouletteUrl: rouletteUrl,
				};
				const Config = {
					headers: {
						'Content-Type': 'application/json',
					},
				};
				try {
					// Calling email service lambda
					const response = await axios.post(
						'https://1ncrakw0d4.execute-api.us-west-1.amazonaws.com',
						body,
						Config
					);
					return res.status(200).send(response.data);
				} catch (error) {
					return res.status(500).send(error);
				}
			});
		})
		.catch((err) => {
			res.status(500).send(err);
		});
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`SERVER Started running on ${PORT}`));
