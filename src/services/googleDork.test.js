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
