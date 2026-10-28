`timescale 1ns / 1ps

// 输入 300 位随机比特流，用 4 位移位寄存器作为参考模型比对两种状态机
module tb;
  logic clk = 0, rst = 1, din = 0;
  logic found_moore, found_mealy;
  logic [3:0] history = 4'b0000;   // 最近 4 位输入（参考模型）
  integer n_moore = 0, n_mealy = 0, n_ref = 0, errors = 0;
  logic   expect_moore = 0;

  seq_detector_moore u_moore (.clk(clk), .rst(rst), .din(din), .found(found_moore));
  seq_detector_mealy u_mealy (.clk(clk), .rst(rst), .din(din), .found(found_mealy));

  always #5 clk = ~clk;

  task automatic send(input logic b);
    logic [3:0] h;
    din = b;
    #1;  // 等 Mealy 组合输出稳定
    h = {history[2:0], b};
    // Mealy：在输入最后一个 1 的同一拍输出
    if (found_mealy !== (h == 4'b1011)) begin
      $display("[%0t] Mealy 错误：history=%b found=%b", $time, h, found_mealy);
      errors = errors + 1;
    end
    // Moore：比 Mealy 晚一拍
    if (found_moore !== expect_moore) begin
      $display("[%0t] Moore 错误：found=%b，期望 %b", $time, found_moore, expect_moore);
      errors = errors + 1;
    end
    if (found_mealy) n_mealy = n_mealy + 1;
    if (found_moore) n_moore = n_moore + 1;
    if (h == 4'b1011) n_ref = n_ref + 1;
    @(posedge clk);
    history = h;
    expect_moore = (h == 4'b1011);
    @(negedge clk);
  endtask

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    repeat (2) @(negedge clk);
    rst = 0;

    // 定向序列：1011011 —— 重叠出现两次
    send(1); send(0); send(1); send(1); send(0); send(1); send(1);
    // 随机序列
    repeat (300) send($random);
    send(0);  // 让 Moore 的最后一次检测输出

    $display("参考模型命中 %0d 次，Mealy %0d 次，Moore %0d 次", n_ref, n_mealy, n_moore);
    if (n_mealy != n_ref || n_moore != n_ref) errors = errors + 1;

    if (errors == 0) $display("PASS: Moore 与 Mealy 序列检测器均正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
