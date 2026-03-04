const test = require('node:test');
const assert = require('node:assert/strict');

const { __testables } = require('./googleDork');

test('extractGoogleResultUrls should parse redirect links and direct links', () => {
  const html = `
    <html><body>
      <a href="/url?q=https%3A%2F%2Fexample.com%2Freport.pdf&sa=U">doc</a>
      <a href="https://another.example.org/page">site</a>
      <a href="https://www.google.com/search?q=test">google</a>
    </body></html>
  `;

  const urls = __testables.extractGoogleResultUrls(html);
  assert.equal(urls.length, 2);
  assert.equal(urls[0], 'https://example.com/report.pdf');
  assert.equal(urls[1], 'https://another.example.org/page');
});

test('detectGoogleBlock should detect captcha/unusual traffic page', () => {
  assert.equal(__testables.detectGoogleBlock('Our systems have detected unusual traffic from your computer network.'), true);
  assert.equal(__testables.detectGoogleBlock('Normal search html without traffic warning'), false);
});


test('extractGoogleResultUrls should parse serialized unicode escaped google payload links', () => {
  const html = String.raw`["/url?sa=t\u0026url=https%3A%2F%2Ffiles.example.net%2Fdump.xlsx%3Fdownload%3D1\u0026ved=2ah"]`;

  const urls = __testables.extractGoogleResultUrls(html);
  assert.equal(urls.length, 1);
  assert.equal(urls[0], 'https://files.example.net/dump.xlsx?download=1');
});

test('summarizeGoogleDiagnostics should produce readable diagnostic lines', () => {
  const summary = __testables.summarizeGoogleDiagnostics([
    { variant: 'default', status: 'ok', htmlLength: 12345, extractedUrlCount: 2 },
    { variant: 'basic', status: 'http_error', httpStatus: 429, htmlLength: 0, extractedUrlCount: 0 }
  ]);

  assert.match(summary, /varian=default, status=ok, http=-, html=12345, url=2/);
  assert.match(summary, /varian=basic, status=http_error, http=429, html=0, url=0/);
});
