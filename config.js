/* Workman Chat – app-owner settings.
   Fill these in ONCE before building and internet chat works the moment anyone installs the app:
   no boxes to fill in, nothing for your users to set up.

   Option A – paste the pieces:
     firebaseApiKey       Firebase console -> Project settings -> General -> Web API Key
     firebaseDatabaseUrl  e.g. https://your-project-default-rtdb.firebaseio.com
     turnServer           OPTIONAL call relay, written as  turn:host:3478|username|password
   Option B – paste one code:
     setupCode            the "Share setup code" from a phone that is already working (starts with WK1-)

   Anything a user types or pastes inside the app (Internet ID & contacts) overrides these defaults on that phone. */
window.WC_CONFIG = {
  firebaseApiKey: 'AIzaSyALFkGWygMgDm-BDuSqnfhenNz0o6_168I',
  firebaseDatabaseUrl: 'https://workman-b2397-default-rtdb.firebaseio.com',
  turnServer: '',
  setupCode: ''
};
