import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInquiry, inquiryMove } from './inquiries';

test('an inquiry needs a name, a real email and a message', () => {
  const ok = validateInquiry({ name: ' Ana ', email: 'ANA@Example.com', message: 'Wedding for 120', guests: '120', kind: 'private_event' });
  assert.equal(ok.email, 'ana@example.com'); assert.equal(ok.guests, 120); assert.equal(ok.name, 'Ana');
  assert.throws(() => validateInquiry({ name: '', email: 'a@b.co', message: 'x' }), /Name/);
  assert.throws(() => validateInquiry({ name: 'A', email: 'nope', message: 'x' }), /email/);
  assert.throws(() => validateInquiry({ name: 'A', email: 'a@b.co', message: '' }), /little/);
  assert.throws(() => validateInquiry({ name: 'A', email: 'a@b.co', message: 'x', kind: 'wedding' }), /show or private/);
  assert.throws(() => validateInquiry({ name: 'A', email: 'a@b.co', message: 'x', guests: -2 }), /whole number/);
  assert.throws(() => validateInquiry({ name: 'A', email: 'a@b.co', message: 'x', dateWanted: 'soon' }), /Valid date/);
});
test('inquiry status moves one way and losing needs a reason', () => {
  inquiryMove('new', 'in_progress', ''); inquiryMove('in_progress', 'won', ''); inquiryMove('new', 'lost', 'Date taken');
  assert.throws(() => inquiryMove('new', 'lost', ' '), /why/);
  assert.throws(() => inquiryMove('won', 'in_progress', ''), /cannot become/);
});
