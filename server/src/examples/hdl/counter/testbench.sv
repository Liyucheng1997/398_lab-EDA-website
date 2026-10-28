`timescale 1ns / 1ps

// 自检测试平台：用软件参考模型逐拍比对计数器输出。
module tb;
  logic       clk = 0;
  logic       rst = 1;
  logic       en  = 0;
  logic [3:0] q;

  integer errors   = 0;
  integer expected = 0;

  counter #(.WIDTH(4)) dut (.clk(clk), .rst(rst), .en(en), .q(q));

  always #5 clk = ~clk;  // 100 MHz 时钟

  // 在下降沿检查：此时上升沿的更新已经稳定
  task automatic check;
    if (q !== expected[3:0]) begin
      $display("[%0t] 错误：q = %0d，期望 %0d", $time, q, expected[3:0]);
      errors = errors + 1;
    end
  endtask

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    // 复位两个周期
    repeat (2) @(posedge clk);
    @(negedge clk);
    expected = 0;
    check();
    rst = 0;
    en  = 1;

    // 计数 20 拍，覆盖 15 -> 0 的回绕
    repeat (20) begin
      @(negedge clk);
      expected = expected + 1;
      check();
    end

    // 关闭使能，输出应保持
    en = 0;
    repeat (3) begin
      @(negedge clk);
      check();
    end

    // 再次复位
    rst = 1;
    @(negedge clk);
    expected = 0;
    check();

    if (errors == 0) $display("PASS: 计数器 %0d 项检查全部通过，最终 q = %0d", 25, q);
    else             $display("FAIL: 共 %0d 处错误", errors);
    $finish;
  end
endmodule
