import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { handleWhatsAppWebhook } from './webhook';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'NeuroWealth WhatsApp Bot Handler' });
});

// WhatsApp Twilio Webhook route
app.post('/api/whatsapp/webhook', handleWhatsAppWebhook);

app.listen(PORT, () => {
  console.log(`🚀 NeuroWealth WhatsApp Bot Handler running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/api/whatsapp/webhook`);
});
