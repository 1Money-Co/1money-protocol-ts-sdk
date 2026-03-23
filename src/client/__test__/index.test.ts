import "mocha";
import { expect } from "chai";
import {
  get,
  post,
  put,
  del,
  patch,
  setInitConfig,
} from "../";
import Request from "../core";

describe("utils test", function () {
  describe("request methods test", function () {
    it("type check", function () {
      expect(get).to.be.a("function");
      expect(post).to.be.a("function");
      expect(put).to.be.a("function");
      expect(del).to.be.a("function");
      expect(patch).to.be.a("function");
      expect(setInitConfig).to.be.a("function");
    });

    it("call methods", function (done) {
      setInitConfig({
        isSuccess: (res: any, status) => status === 200 && res?.id != null,
      });
      expect(post<{
        id: number;
        result: string;
        jsonrpc: string;
      }>('https://ethereum-rpc.publicnode.com/', {
        id: 1,
        jsonrpc: "2.0",
        method: "eth_blockNumber"
      }).success(res => {
        expect(res).to.be.an('object');
        expect(res).to.has.property('id').to.equal(1);
        expect(res).to.has.property('jsonrpc').to.equal('2.0');
        expect(res).to.has.property('result').to.be.a('string');
        done();
      }).rest(() => done()));
    });
  });

  describe("abort on timeout", function () {
    it("should abort the underlying request when timeout fires", function (done) {
      const client = new Request({ timeout: 100 });

      // 192.0.2.1 is a TEST-NET address (RFC 5737) that will never respond
      client.request({
        method: "get",
        url: "http://192.0.2.1/delay",
      })
        .timeout((err) => {
          try {
            expect(err).to.be.an("object");
            expect(err).to.have.property("message", "timeout");
            done();
          } catch (e) {
            done(e);
          }
          return err;
        })
        .error((err) => {
          done(new Error("error handler called instead of timeout"));
          return err;
        });
    });

    it("should respect a user-provided AbortSignal", function (done) {
      const client = new Request({ timeout: 60000 });
      const abortCtrl = new AbortController();

      client.request({
        method: "get",
        url: "http://192.0.2.1/delay",
        signal: abortCtrl.signal,
      })
        .error((err) => {
          try {
            expect(err).to.be.an("object");
            expect(err).to.have.property("name");
            done();
          } catch (e) {
            done(e);
          }
          return err;
        })
        .timeout((err) => {
          done(new Error("timeout handler called — user abort should trigger error"));
          return err;
        });

      // Abort after 100ms — well before the 60s SDK timeout
      setTimeout(() => abortCtrl.abort(), 100);
    });
  });
});
