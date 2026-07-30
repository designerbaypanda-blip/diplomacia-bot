const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');

// Initialize Firebase Admin with environment variable
// You need to set FIREBASE_SERVICE_ACCOUNT base64 encoded JSON in Render.com environment variables
// Or if you only have FIREBASE_DATABASE_URL and want to use open rules temporarily:
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log("Firebase Admin initialized.");
  } else {
    console.warn("FIREBASE_SERVICE_ACCOUNT env var not found. Database writes will fail if not open.");
  }
} catch (e) {
  console.error("Firebase init error:", e);
}

const app = express();
const port = process.env.PORT || 3000;

// Simple endpoint to keep the server alive and manually trigger sync
app.get('/sync', async (req, res) => {
  try {
    await performSync();
    res.send({ status: 'success', message: 'Sync completed.' });
  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).send({ status: 'error', error: error.message });
  }
});

// Root endpoint for simple health check
app.get('/', (req, res) => {
  res.send('Diplomacia Bot is running.');
});

// Building costs (from your Dart code)
function getBuildingCost(type) {
  switch (type) {
    case 'okul': return { money: 1000, gold: 2, leather: 10, oil: 0, nte: 0 };
    case 'askeri_us': return { money: 5000, gold: 10, leather: 10, oil: 10, nte: 10 };
    case 'hastane': return { money: 3000, gold: 5, leather: 15, oil: 5, nte: 5 };
    case 'yol': return { money: 500, gold: 0, leather: 0, oil: 5, nte: 0 };
    case 'pazar': return { money: 2000, gold: 5, leather: 5, oil: 5, nte: 0 };
    case 'liman': return { money: 10000, gold: 20, leather: 0, oil: 20, nte: 10 };
    case 'tersane': return { money: 15000, gold: 30, leather: 0, oil: 30, nte: 15 };
    case 'havaalani': return { money: 20000, gold: 40, leather: 0, oil: 40, nte: 20 };
    default: return { money: 0, gold: 0, leather: 0, oil: 0, nte: 0 };
  }
}

async function performSync() {
  const timestamp = Date.now();
  console.log(`Starting sync at ${timestamp}`);

  // 1. Fetch Market
  const cheapestPrices = { altin: 0, deri: 0, petrol: 0, nte: 0 };
  try {
    const marketResponse = await axios.get('https://diplomacia.com.tr/api/market/listings');
    // the api endpoint actually is /api/market/resource/... but we can fetch them separately
    // Since we don't have the exact listing endpoint, we will fetch them one by one like in the app
  } catch(e) {}
  
  const resources = ['altin', 'deri', 'petrol', 'nte'];
  for (const res of resources) {
    try {
      const resp = await axios.get(`https://diplomacia.com.tr/api/market/resource/${res}`);
      if (resp.data && Array.isArray(resp.data)) {
        let minPrice = 0;
        for (let item of resp.data) {
          let price = parseFloat(item.unit_price) || 0;
          if (price > 0 && (minPrice === 0 || price < minPrice)) {
            minPrice = price;
          }
        }
        cheapestPrices[res] = minPrice;
      }
    } catch(e) {
      console.error(`Error fetching market for ${res}:`, e.message);
    }
  }

  // Save market to Firebase
  const db = admin.database();
  for (const res of resources) {
    if (cheapestPrices[res] > 0) {
      await db.ref(`history/market/${res}/${timestamp}`).set({
        timestamp: timestamp,
        cheapest_price: cheapestPrices[res]
      });
    }
  }

  // 2. Fetch Leaderboard (All Countries & States)
  try {
    const leaderResp = await axios.get('https://diplomacia.com.tr/api/leaderboard?limit=300');
    if (leaderResp.data && Array.isArray(leaderResp.data)) {
      
      for (const country of leaderResp.data) {
        let countryWealth = parseFloat(country.money) || 0;
        const countryName = country.country_name || 'Unknown';
        
        // Save states and add to country wealth
        if (country.states && Array.isArray(country.states)) {
          for (const state of country.states) {
             const stateName = state.state_name;
             const sMoney = parseFloat(state.money) || 0;
             const sGold = parseFloat(state.gold) || 0;
             const sLeather = parseFloat(state.leather) || 0;
             const sOil = parseFloat(state.oil) || 0;
             const sNte = parseFloat(state.nte) || 0;

             countryWealth += sMoney;

             await db.ref(`history/states/${countryName}_${stateName}/${timestamp}`).set({
               timestamp: timestamp,
               country_name: countryName,
               state_name: stateName,
               money: sMoney,
               gold: sGold,
               leather: sLeather,
               oil: sOil,
               nte: sNte
             });
          }
        }
        
        // Save country
        await db.ref(`history/countries/${countryName}/${timestamp}`).set({
           timestamp: timestamp,
           country_name: countryName,
           wealth: countryWealth
        });
      }
    }
  } catch(e) {
    console.error(`Error fetching leaderboard:`, e.message);
  }

  console.log('Sync complete.');
}

app.listen(port, () => {
  console.log(`Bot listening on port ${port}`);
});
