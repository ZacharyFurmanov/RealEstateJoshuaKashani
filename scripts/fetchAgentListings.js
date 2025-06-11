const OWNER_KEY = process.env.AGENT_KEY || '2644';
const OWNER_RT = 'AGENT';
// use built-in fetch API (Node 18+)
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
// Increase page size so we can retrieve larger result sets in one request
// The Agora endpoint currently allows up to 200 without throttling.
const PAGE_SIZE = 200;
const BASE_URL = 'https://www.theagencyre.com/services/agoraGetFeaturedProperties.ashx';

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

/**
 * Attempt to fetch an RT that may or may not exist for every agent.
 * Returns an empty object with an empty Items array if the RT is unknown.
 */
async function fetchOptionalRT(rt) {
  try {
    return await fetchAllByRT(rt);
  } catch (err) {
    // Most likely the server returns 400 “Unknown RT” – just ignore gracefully
    console.warn(`RT ${rt} not available: ${err.message}`);
    return { Items: [] };
  }
}

async function main() {
  try {
    // Try to pull a past‑rentals feed as well (some agents have it; others don’t)
    const [current, sold, past, pastLeased, comingSoon, pending] = await Promise.all([
      fetchAllByRT('CMNCMN'),
      fetchAllByRT('CMNSLD'),
      fetchAllByRT('PASTTRANSACTIONS'),
      fetchOptionalRT('PASTLEASED'),          // extra feed that often holds “Rented” listings
      fetchOptionalRT('COMINGSOON'),
      fetchOptionalRT('PENDING')
    ]);

    console.table({
      current:     (current.Items     || []).length,
      sold:        (sold.Items        || []).length,
      past:        (past.Items        || []).length,
      pastLeased:  (pastLeased.Items  || []).length,
      comingSoon:  (comingSoon.Items  || []).length,
      pending:     (pending.Items     || []).length
    });

    function ensureImage(listing) {
      if (listing.ImageURL) return listing;
      const fallback =
        listing.LargePhotoURL ||
        listing.PhotoUrl ||
        (listing.Photos && listing.Photos[0] && listing.Photos[0].Uri) ||
        null;
      return { ...listing, ImageURL: fallback };
    }

    const availableRentals = (current.Items || [])
      .filter(
        item =>
          item.IsRental &&
          /^active/i.test(item.Status || '')    // includes “Active”, “Active Under Contract”, etc.
      )
      .map(ensureImage);

    const forSaleHouses = [...(current.Items || []), ...(comingSoon.Items || []), ...(pending.Items || [])]
      .filter(
        item =>
          !item.IsRental &&
          /^(active|coming soon|pending)/i.test(item.Status || '')
      )
      .map(ensureImage);

    // Combine current, past, sold, and pastLeased items to capture any rentals that ended up in the “sold” feed or past leased feed
    const leasedUnits = [...current.Items, ...past.Items, ...sold.Items, ...(pastLeased.Items || [])]
      .filter(item =>
        /(leased|closed|rented)/i.test((item.Status || '').trim()) ||
        /(rented)/i.test(((item.Banner || item.PropertyBanner || item.BannerLabel || '')).trim())
      )
      .map(ensureImage);

    const soldHouses = (sold.Items || [])
      // Exclude anything whose status contains “Rented” or “Leased” so it doesn’t duplicate in both lists
      .filter(item =>
        !/(leased|rented)/i.test((item.Status || '').trim()) &&                       // not explicitly leased/rented status
        !/(rented)/i.test(((item.Banner || item.PropertyBanner || item.BannerLabel || '')).trim()) && // not banner‑rented
        !item.IsRental &&                                                            // not a rental
        !pastLeased.Items.some(r => r.MLSNumber === item.MLSNumber)                  // not in past‑leased feed
      )
      .map(ensureImage);

    const output = {
      availableRentals,
      leasedUnits,
      forSaleHouses,
      soldHouses
    };
    const outPath = path.join(__dirname, '../public/listings.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`Wrote ${Object.values(output).reduce((sum, arr) => sum + arr.length, 0)} listings to ${outPath}`);
    // console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.error('Error fetching listings:', err.message);
    process.exit(1);
  }
}

main();
