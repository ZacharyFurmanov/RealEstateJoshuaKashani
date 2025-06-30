// Configuration
const OWNER_KEY = process.env.AGENT_KEY || '2644';
const OWNER_RT = 'AGENT';
const PAGE_SIZE = 500;
const BASE_URL = 'https://www.theagencyre.com/services/agoraGetFeaturedProperties.ashx';

// Dependencies
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

// API Request Handler
async function fetchByRT(rt, pageNum = 1) {
  const params = {
    ownerPK: OWNER_KEY,
    ownerRT: OWNER_RT,
    RT: rt,
    urlQuery: '',
    Q: '',
    PageSize: PAGE_SIZE,
    pageNum
  };
  // build full URL with query parameters
  const url = new URL(BASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, String(value));
  });
  // perform request using fetch
  const res = await fetch(url.toString(), {
    headers: {
      // Must match the agent detail page Referer and Origin
      'Referer': 'https://www.theagencyre.com/agent/joshua-kashani',
      'Origin': 'https://www.theagencyre.com',
      // Browser AJAX flag
      'X-Requested-With': 'XMLHttpRequest',
      // Standard browser UA
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01'
    }
  });
  if (!res.ok) {
    throw new Error(`Error fetching ${rt}: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

// Pagination Handler
async function fetchAllByRT(rt) {
  let page = 1;
  let combined = { Items: [] };

  while (true) {
    const res = await fetchByRT(rt, page);
    combined = { ...res, Items: [...combined.Items, ...(res.Items || [])] };

    if (!res.Items || res.Items.length < PAGE_SIZE) break;   // last page reached
    page += 1;
  }
  return combined;
}

// Optional Feed Handler
async function fetchOptionalRT(rt) {
  try {
    return await fetchAllByRT(rt);
  } catch (err) {
    // Most likely the server returns 400 “Unknown RT” – just ignore gracefully
    console.warn(`RT ${rt} not available: ${err.message}`);
    return { Items: [] };
  }
}

// Main Execution
async function main() {
  try {
    // Fetch Multiple Feed Types
    const [current, sold, past, pastLeased, comingSoon, pending] = await Promise.all([
      fetchAllByRT('CMNCMN'),
      fetchAllByRT('CMNSLD'),
      fetchAllByRT('PASTTRANSACTIONS'),
      fetchOptionalRT('PASTLEASED'),
      fetchOptionalRT('COMINGSOON'),
      fetchOptionalRT('PENDING')
    ]);

    // Feed Processing
    const feeds = {
      current:     (current.Items     || []).map(ensureImage),
      sold:        (sold.Items        || []).map(ensureImage),
      past:        (past.Items        || []).map(ensureImage),
      pastLeased:  (pastLeased.Items  || []).map(ensureImage),
      comingSoon:  (comingSoon.Items  || []).map(ensureImage),
      pending:     (pending.Items     || []).map(ensureImage)
    };

    // Statistics
    const allListings = Object.values(feeds).flat();
    console.table(
      Object.fromEntries(
        Object.entries(feeds).map(([key, arr]) => [key, arr.length])
      )
    );

    // Image Handling
    function ensureImage(listing) {
      if (listing.ImageURL) return listing;
      const fallback =
        listing.LargePhotoURL ||
        listing.PhotoUrl ||
        (listing.Photos && listing.Photos[0] && listing.Photos[0].Uri) ||
        null;
      return { ...listing, ImageURL: fallback };
    }

    // Output Generation
    const output = feeds;
    // Log timestamp
    const timestampLogPath = path.join(__dirname, 'fetchTimestamps.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(timestampLogPath, `${timestamp}\n`, 'utf-8');
    const outPath = path.join(__dirname, '../public/listings.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`Wrote ${allListings.length} listings to ${outPath}`);
  } catch (err) {
    console.error('Error fetching listings:', err.message);
    process.exit(1);
  }
}

// Execute
main();
