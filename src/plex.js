const axios = require('axios');

class PlexClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  async getLibraries() {
    const response = await axios.get(`${this.baseUrl}/library/sections`, {
      params: { 'X-Plex-Token': this.token }
    });
    return response.data.MediaContainer.Directory;
  }

  async getUsers() {
    const response = await axios.get(`${this.baseUrl}/users`, {
      params: { 'X-Plex-Token': this.token }
    });
    return response.data.MediaContainer.User;
  }

  async createUser(email, username) {
    const response = await axios.post(`${this.baseUrl}/users`, {
      type: 'email',
      identifier: email,
      title: username
    }, {
      params: { 'X-Plex-Token': this.token }
    });
    return response.data.MediaContainer.User;
  }

  async addLibraryAccess(userId, libraryId) {
    await axios.post(`${this.baseUrl}/users/${userId}/grants/direct`, {
      type: 'directory',
      identifier: libraryId
    }, {
      params: { 'X-Plex-Token': this.token }
    });
  }

  async removeLibraryAccess(userId, libraryId) {
    await axios.delete(`${this.baseUrl}/users/${userId}/grants/direct`, {
      params: {
        type: 'directory',
        identifier: libraryId,
        'X-Plex-Token': this.token
      }
    });
  }

  async getUserLibraries(userId) {
    const response = await axios.get(`${this.baseUrl}/users/${userId}/grants/direct`, {
      params: { 'X-Plex-Token': this.token }
    });
    return response.data.MediaContainer.Directory;
  }
}

module.exports = PlexClient;
