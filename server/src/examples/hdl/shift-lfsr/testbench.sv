`timescale 1ns / 1ps

module tb;
  logic       clk = 0, rst = 1;
  logic       load = 0, shift = 0, dir = 0, sin = 0;
  logic [7:0] d = 0, q, lq;
  logic       sout, len = 0;
  integer     errors = 0;

  shift_register #(.W(8)) sr (
    .clk(clk), .rst(rst), .load(load), .d(d), .shift(shift),
    .dir(dir), .sin(sin), .q(q), .sout(sout)
  );
  lfsr8 #(.SEED(8'h01)) lfsr (.clk(clk), .rst(rst), .en(len), .q(lq));

  always #5 clk = ~clk;

  task automatic expect_q(input logic [7:0] exp, input string what);
    if (q !== exp) begin
      $display("错误（%s）：q = %b，期望 %b", what, q, exp);
      errors = errors + 1;
    end
  endtask

  initial begin
    integer     period;
    logic [7:0] seen [0:255];
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    @(negedge clk) rst = 0;

    // 1) 并行装载
    load = 1; d = 8'b1011_0001;
    @(negedge clk) load = 0;
    expect_q(8'b1011_0001, "load");

    // 2) 左移 3 次，串入 1,0,1
    shift = 1; dir = 0;
    sin = 1; @(negedge clk);
    sin = 0; @(negedge clk);
    sin = 1; @(negedge clk);
    expect_q(8'b1000_1101, "shift left");

    // 3) 右移 2 次，串入 1,1
    dir = 1; sin = 1;
    repeat (2) @(negedge clk);
    expect_q(8'b1110_0011, "shift right");
    shift = 0;

    // 4) LFSR：统计周期，并确认 255 个状态互不相同
    for (integer i = 0; i < 256; i = i + 1) seen[i] = 0;
    len = 1;
    period = 0;
    do begin
      if (seen[lq] != 0) begin
        $display("错误：状态 %h 在周期内重复出现", lq);
        errors = errors + 1;
      end
      seen[lq] = 1;
      @(negedge clk);
      period = period + 1;
    end while (lq != 8'h01 && period < 300);
    $display("LFSR 周期 = %0d", period);
    if (period != 255) errors = errors + 1;

    if (errors == 0) $display("PASS: 移位寄存器与 LFSR 全部正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
