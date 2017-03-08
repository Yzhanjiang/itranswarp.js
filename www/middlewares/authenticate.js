/**
 * koa middleware that try to authenticate user from cookie, header, etc.
 * 
 * Use ctx.state.__user__ to access user object.
 */

const
    crypto = require('crypto'),
    logger = require('../logger'),
    config = require('../config'),
    constants = require('../constants'),
    api = require('../api'),
    db = require('../db'),
    COOKIE_NAME = config.session.cookie,
    COOKIE_SALT = config.session.salt,
    COOKIE_EXPIRES_IN_MS = config.session.expires * 1000;

var
    User = db.user,
    LocalUser = db.localuser,
    AuthUser = db.authuser;

// parse header 'Authorization: Basic xxxx'
async function _parseAuthorization(auth) {
    logger.debug('try parse header: Authorization: ' + auth);
    if ((auth.length < 6) || (auth.substring(0, 6) !== 'Basic ')) {
        return null;
    }
    var
        u, p, user, luser,
        up = Buffer.from(auth.substring(6), 'base64').toString().split(':');
    if (up.length !== 2) {
        return null;
    }
    u = up[0];
    p = up[1];
    if (!u || !p) {
        return null;
    }
    user = await User.findOne({
        where: { 'email': u }
    });
    if (user) {
        luser = await LocalUser.findOne({
            where: { 'user_id': user.id }
        });
        if (luser && _verifyPassword(luser.id, p, luser.passwd)) {
            logger.debug('binded user: ' + user.name);
            return user;
        }
    }
    logger.debug('invalid authorization header.');
    return null;
}

module.exports = async (ctx, next) => {
    ctx.state.__user__ = null;
    let
        auth,
        user,
        request = ctx.request,
        response = ctx.response,
        path = request.path,
        cookie = request.cookies.get(COOKIE_NAME);
    if (cookie) {
        logger.info('try to parse session cookie...');
        user = await parseSessionCookie(cookie);
        if (user) {
            logger.info('bind user from session cookie: ' + user.email)
        } else {
            logger.info('invalid session cookie. cleared.');
            response.cookies.set(COOKIE_NAME, 'deleted', {
                path: '/',
                httpOnly: true,
                expires: new Date(0)
            });
        }
    }
    if (user === null) {
        auth = request.get('authorization');
        if (auth) {
            logger.info('try to parse authorization header...');
            user = await _parseAuthorization(auth);
            if (user) {
                logger.info('bind user from authorization: ' + user.email);
            } else {
                logger.warn('invalid authorization header.');
            }
        }
    }
    if (user) {
        ctx.state.__user__ = {
            id: user.id,
            role: user.role,
            email: user.email,
            verified: user.verified,
            name: user.name,
            image_url: user.image_url,
            created_at: user.created_at
        };
    }
    ctx.state.checkPermission = (expectedRole) => {
        if (ctx.state.__user__ === null || (ctx.state.__user__.role > expectedRole)) {
            logger.warn('check permission failed: expected = ' + expectedRole + ', actual = ' + (ctx.state.__user__ ? ctx.state.__user__.role : 'null'));
            throw api.notAllowed('Do not have permission.');
        }
    };
    // check if login required for management:
    if (path.substring(0, 8) === '/manage/' && path !== '/manage/signin') {
        if (!ctx.state.__user__ || ctx.state.__user__.role > constants.role.CONTRIBUTOR) {
            response.redirect('/manage/signin');
            return;
        }
    }
    await next();
};