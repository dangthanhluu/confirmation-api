const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// Lưu trữ nội bộ
let confirmationCodes = [];
let accounts = [];

// SKU ID
const licenseMap = {
  a1_teacher: '94763226-9b3c-4e75-a931-5c89701abe66',
  a1_student: '314c4481-f395-4525-be8b-2ec4bb1e9d91',
  a3_school: 'e578b273-6db4-4691-bba0-8d691f4da603'
};

// Middleware xác thực giả lập
const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader === 'Bearer admin-token') {
    next();
  } else {
    res.status(401).json({ error: 'Chỉ dành cho nhà quản lý.' });
  }
};

app.post('/verify-code', async (req, res) => {
  const { code, school } = req.body;

  try {
    const codeEntry = confirmationCodes.find(c => c.code === code && !c.used && (c.school === school || c.school === 'Any'));
    if (codeEntry) {
      res.json({ valid: true });
    } else {
      res.json({ valid: false, error: 'Mã xác nhận không hợp lệ hoặc không phù hợp với trường học.' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/generate-codes', authenticateAdmin, async (req, res) => {
  const { codes } = req.body;

  try {
    const newCodes = codes.map(item => ({
      code: item.code,
      used: false,
      createdAt: new Date(),
      school: item.school || 'Any'
    }));
    confirmationCodes.push(...newCodes);
    res.json({ message: 'Tạo mã thành công', codes: newCodes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/list-codes', authenticateAdmin, async (req, res) => {
  try {
    res.json(confirmationCodes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/list-accounts', authenticateAdmin, async (req, res) => {
  try {
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/create-teacher', async (req, res) => {
  const {
    firstName, lastName, displayName, username, domain, password, passwordType, school,
    license, jobTitle, department, city, state, postalCode, country, confirmationCode
  } = req.body;

  try {
    const codeEntry = confirmationCodes.find(c => c.code === confirmationCode && !c.used && (c.school === school || c.school === 'Any'));
    if (!codeEntry) {
      return res.status(400).json({ error: 'Mã xác nhận không hợp lệ hoặc đã được sử dụng.' });
    }

    const tokenResponse = await axios.post(
      `https://login.microsoftonline.com/f0ffab0e-a105-426c-83d5-6cc1ff605f89/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: '260800c4-531c-4a89-9e47-1ca18a1de794',
        client_secret: process.env.CLIENT_SECRET || '010e27a8-ce22-4e55-bd67-fd14935f5383',
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const accessToken = tokenResponse.data.access_token;

    const userResponse = await axios.post(
      'https://graph.microsoft.com/v1.0/users',
      {
        accountEnabled: true,
        givenName: firstName,
        surname: lastName,
        displayName: displayName,
        mailNickname: username,
        userPrincipalName: `${username}${domain}`,
        passwordProfile: {
          forceChangePasswordNextSignIn: true,
          password: password
        },
        jobTitle: jobTitle,
        department: department,
        city: city,
        state: state,
        postalCode: postalCode,
        country: country,
        'extension_260800c4531c4a899e471ca18a1de794_school': school
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (license && licenseMap[license]) {
      await axios.post(
        `https://graph.microsoft.com/v1.0/users/${userResponse.data.id}/assignLicense`,
        {
          addLicenses: [{ disabledPlans: [], skuId: licenseMap[license] }],
          removeLicenses: []
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
    }

    codeEntry.used = true;

    accounts.push({
      userId: userResponse.data.id,
      displayName,
      userPrincipalName: `${username}${domain}`,
      confirmationCode,
      license,
      createdAt: new Date()
    });

    res.json({ message: 'Tạo tài khoản thành công', userId: userResponse.data.id });
  } catch (error) {
    res.status(500).json({ error: error.response?.data?.error?.message || error.message });
  }
});

app.post('/update-teacher', async (req, res) => {
  const {
    userId, firstName, lastName, displayName, license, jobTitle, department,
    city, state, postalCode, country, school
  } = req.body;

  try {
    const tokenResponse = await axios.post(
      `https://login.microsoftonline.com/f0ffab0e-a105-426c-83d5-6cc1ff605f89/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: '260800c4-531c-4a89-9e47-1ca18a1de794',
        client_secret: process.env.CLIENT_SECRET || '010e27a8-ce22-4e55-bd67-fd14935f5383',
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const accessToken = tokenResponse.data.access_token;

    await axios.patch(
      `https://graph.microsoft.com/v1.0/users/${userId}`,
      {
        givenName: firstName,
        surname: lastName,
        displayName: displayName,
        jobTitle: jobTitle,
        department: department,
        city: city,
        state: state,
        postalCode: postalCode,
        country: country,
        'extension_260800c4531c4a899e471ca18a1de794_school': school
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (license && licenseMap[license]) {
      const userLicenses = await axios.get(
        `https://graph.microsoft.com/v1.0/users/${userId}/licenseDetails`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const currentSkus = userLicenses.data.value.map(license => license.skuId);

      if (currentSkus.length > 0) {
        await axios.post(
          `https://graph.microsoft.com/v1.0/users/${userId}/assignLicense`,
          {
            addLicenses: [],
            removeLicenses: currentSkus
          },
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
      }

      await axios.post(
        `https://graph.microsoft.com/v1.0/users/${userId}/assignLicense`,
        {
          addLicenses: [{ disabledPlans: [], skuId: licenseMap[license] }],
          removeLicenses: []
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
    }

    const account = accounts.find(a => a.userId === userId);
    if (account) {
      account.displayName = displayName;
      account.license = license;
    }

    res.json({ message: 'Cập nhật thành công' });
  } catch (error) {
    res.status(500).json({ error: error.response?.data?.error?.message || error.message });
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server running on port ${port}`));