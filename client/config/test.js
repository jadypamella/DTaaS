if (typeof window !== 'undefined') {
  window.env = {
    REACT_APP_ENVIRONMENT: 'test',
    REACT_APP_URL: 'http://localhost:4000/',
    REACT_APP_URL_BASENAME: '',
    REACT_APP_URL_DTLINK: '/lab',
    REACT_APP_URL_LIBLINK: '',

    REACT_APP_CLIENT_ID:
      '6b239b65346cb61bca53d4def5bae7a50afa279f98dab7c06d17675a840b599a',
    REACT_APP_AUTH_AUTHORITY: 'https://dtl-server-2.st.lab.au.dk/gitlab',
    REACT_APP_REDIRECT_URI: 'http://localhost:4000/Library',
    REACT_APP_LOGOUT_REDIRECT_URI: 'http://localhost:4000/',
    REACT_APP_GITLAB_SCOPES: 'openid profile read_user read_repository api',
    LOGGER_URL: 'http://localhost:4003/logger', // NOSONAR
  };
}
