//This is an unbuffered Promise queue: queue.add(promise) returns a promise that resolves when the queue has a free slot.
//It can be used within a loop to "multithread" repetitive, non-blocking tasks like ETL, web crawling, etc.
//Queue size is dynamically adjustable and can be set to 0 momentarily to block adding new promises.
//config:
//...
//helper functions:
//...
//add() / waitOne() can be called more than once, and each call will resolve in order as slots become available.
//notes:
//There is no buffer implementation here, instead, waitOne promises are re-chained until a slot becomes available. This mode works well for one to a few concurrent loops awaiting for slots.
//As a result of shrinking the queue, removed slots are put into a queue, and reused when expanding the queue again in a FIFO manner
//promise results should be managed outside, queue is only used as execution order/speed management
//TODO
//add waitAll() isIdle / waitAllSettled() on the same model as waitOne
//what happens of rejected promises?
//possible continuous (vs default fixedSize) queue mode by doing autoexpand (+maxsize +autoclear res/rej)
function qu(sz) {
  let _i = -1;
  let _size = sz;
  const _qu = new Map(
    Array.from({ length: _size }, () => [++_i, Promise.resolve(_i)])
  );
  const deletedSlots = [];
  /**
   * Returns current target size, i.e. the value of the last setSize() call
   */
  const requestedSize = () => _size;
  /**
   * Returns current actual size, differs from requestedSize() if there has been a request to shorten the queue but more slots are busy.
   */
  const currentSize = () => _qu.size;
  let _isResize = 0;
  let _isWaitOne = false;
  let _waitOnePromise;
  let __shortRaceRes = () => { };
  //race shorter fn
  let _shortRace = () => {
    __shortRaceRes(-1);
  };
  //creates a race promise with current qu values + race shorter
  const _racer = () =>
    Promise.race([
      ..._qu.values(),
      new Promise((r) => {
        __shortRaceRes = r;
      }),
    ]);
  /**
   * Wait for a slot to be available, returns free slot id
   * If the function is called more than once asynchronously, calls will resolve one at a time.
   * @_f(slot) : callback that executes immediately when a slot is free (conversely, `await waitOne(); do stuff;` may not resume to `do stuff` immediately after `waitOne()` resolves)
   */
  function waitOne(_f) {
    // console.log(`w: ${v}: called`)
    if (_isWaitOne) {
      //return a promise that resolves when the call that set _isWaitOne resolves
      //keep returning waitOne to ensure all current calls resolve one by one
      // console.log(`w: ${v}: is waiting`)
      return _waitOnePromise.then(() => { return waitOne(_f) })
    }
    // console.log(`w: ${v}: NOT waiting, start`)
    _isWaitOne = true;
    //recursive promise function:
    _waitOnePromise = (function R(p) {
      //we call function immediately with race promise, so p is a promise awaiting for a free slot
      return p.then((slot) => {
        //got a free slot / race was shorted (by a new resize)
        //if race was shorted, we relaunch race with the new qu
        if (slot === -1) {
          return R(_racer());
        } else {
          if (_isResize === 0) {
            //got a real free slot, return it
            return slot;
          } else {
            //sizing down: remove slot from qu
            _qu.delete(slot);
            deletedSlots.push(slot);
            _isResize--;
            //and relaunch race
            return R(_racer());
          }
        }
        //recurse
      });
    })(_racer());
    return _waitOnePromise.then((slot) => {
      // console.log(`w: ${v}: resolved`);
      _isWaitOne = false;
      _waitOnePromise = undefined
      if (_f) _f(slot)
      return slot
    });
  };
  //   /**
  //    * Wait for all pending promises in queue
  //    */
  //   const waitAll = () => {
  //     if (!_isWaitOne) {
  //       _isWaitOne = true;
  //       //recursive promise function:
  //       _waitOnePromise = (function R(p) {
  //         //we call function immediately with race promise, so p is a promise awaiting for a free slot
  //         return p.then((slot) => {
  //           //got a free slot / race was shorted (by a new resize)
  //           //if race was shorted, we relaunch race with the new qu
  //           if (slot === -1) {
  //             return R(_racer());
  //           } else {
  //             if (_isResize === 0) {
  //               //got a real free slot, return it
  //               return slot;
  //             } else {
  //               //sizing down: remove slot from qu
  //               _qu.delete(slot);
  //               _isResize--;
  //               //and relaunch race
  //               return R(_racer());
  //             }
  //           }
  //           //recurse
  //         });
  //       })(_racer());
  //       _waitOnePromise.then(() => {
  //         _isWaitOne = false;
  //       });
  //     }
  //     return _waitOnePromise;
  //   };
  /**
   * Request to change queue size
   */
  function setSize(newThrCnt) {
    if (newThrCnt >= _qu.size) {
      //new size bigger than current qu
      for (let i = _qu.size; i < newThrCnt; i++) {
        //add slots
        if (deletedSlots.length) {
          j = deletedSlots.shift();
          _qu.set(j, Promise.resolve(j));
        } else {
          _qu.set(++_i, Promise.resolve(_i));
        }
      }
      _isResize = 0;
    } else {
      //new size smaller than current qu
      _isResize = _qu.size - newThrCnt;
    }
    //short race
    if (_isWaitOne) _shortRace();
    _size = newThrCnt;
  };
  /**
   * Add task to queue
   * @returns -- {promise, slot} when a slot is free
   *
   * @this -- optional: `this` object for `func`
   * @func -- a function that returns the task to add and returns a Promise, it is only executed after a slot is available
   * @args -- extra args to pass to `func`
   */
  async function add(...args) {
    let that;
    if (typeof args[0] === "object") that = args.shift();
    const f = args.shift();
    //TEST ONLY, REMOVE!
    // const v = args.shift()
    let promise, slot
    await waitOne((s) => {
      // console.log("slot:", s, "set new promise")
      promise = f.call(that, ...args);
      slot = s;
      _qu.set(
        s,
        promise
          .catch((e) => {
            console.error(`QUEUE: SLOT ${s}: ${e}`);
          })
          .then(() => s)
      );
    });
    return { promise, slot };
  };
  /** Returns the promise in given slot */
  const get = (slot) => _qu.get(slot);
  return { add, get, waitOne, setSize, requestedSize, currentSize };
}

// test();
async function test() {
  const queue = qu(2);
  const t0 = new Date();
  let slot;
  const resizeQu = (newSz, t) =>
    setTimeout(() => {
      console.log(new Date() - t0, "set qu size to " + newSz);
      queue.setSize(newSz);
    }, t);
  const task = (t) =>
    new Promise((r) => {
      setTimeout(() => {
        r();
      }, t);
    });
  //resize queue at fixed time points
  resizeQu(3, 11000);
  resizeQu(1, 14000);
  resizeQu(4, 16000);
  resizeQu(2, 18000);
  resizeQu(0, 26000);
  resizeQu(1, 30000);
  //simulate tasks
  //TIME SLOT INFO
  //0    s0
  slot = (await queue.add(task, 5000)).slot;
  console.log(new Date() - t0, slot);
  // //start waitAll after inserting first task
  // queue.waitAll().then(() => console.log("no more task"));
  //0    s1
  slot = (await queue.add(task, 3000)).slot;
  console.log(new Date() - t0, slot);
  //3    s1
  slot = (await queue.add(task, 5000)).slot;
  console.log(new Date() - t0, slot);
  //5    s0
  slot = (await queue.add(task, 2000)).slot;
  console.log(new Date() - t0, slot);
  //7    s0
  slot = (await queue.add(task, 8000)).slot;
  console.log(new Date() - t0, slot);
  //8    s1
  slot = (await queue.add(task, 5000)).slot;
  console.log(new Date() - t0, slot);
  //11         qu size: 3
  //11   s2
  slot = (await queue.add(task, 6000)).slot;
  console.log(new Date() - t0, slot);
  //13   s1
  slot = (await queue.add(task, 7000)).slot;
  console.log(new Date() - t0, slot);
  //14         qu size: 1
  //15   s0    delete slot 0 (slots: (-0),1,2)
  //16         qu size: 4 (slots: 1,2,+0,+3)
  //16   s0
  slot = (await queue.add(task, 5000)).slot;
  console.log(new Date() - t0, slot);
  //16   s3
  slot = (await queue.add(task, 3000)).slot;
  console.log(new Date() - t0, slot);
  //17   s2
  slot = (await queue.add(task, 5000)).slot;
  console.log(new Date() - t0, slot);
  //18         qu size: 2
  //19   s3    delete slot 3 (slots: 1,2,0,(-3))
  //20   s1    delete slot 1 (slots: (-1),2,0)
  //21   s0
  slot = (await queue.add(task, 3000)).slot;
  console.log(new Date() - t0, slot);
  //22   s2
  slot = (await queue.add(task, 1000)).slot;
  console.log(new Date() - t0, slot);
  //23   s2
  //24   s0    awaitAll() resolves
  //25
  await new Promise((r) => setTimeout(r, 3000));
  //25   s2    we can keep adding tasks
  slot = (await queue.add(task, 2000)).slot;
  console.log(new Date() - t0, slot);
  //25   s0
  slot = (await queue.add(task, 3000)).slot;
  console.log(new Date() - t0, slot);
  //26         qu size: 0
  //27   s2    delete slot 2 (slots: (-2),0)
  //28   s0    delete slot 0 (slots: (-0))
  //30         qu size: 1 (slots: +3)
  //30   s3
  slot = (await queue.add(task, 3000)).slot;
  console.log(new Date() - t0, slot);
}

module.exports = qu;
