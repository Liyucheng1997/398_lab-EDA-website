`timescale 1ns / 1ps

// 穷举测试：半加器 4 种输入、全加器 8 种输入，并打印真值表
module tb;
  logic a, b, cin;
  logic hs, hc, fs, fc;
  integer errors = 0;

  half_adder ha (.a(a), .b(b), .s(hs), .c(hc));
  full_adder fa (.a(a), .b(b), .cin(cin), .s(fs), .cout(fc));

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    $display(" a b cin | 半加 c s | 全加 cout s");
    $display("---------+----------+------------");
    for (integer i = 0; i < 8; i = i + 1) begin
      {cin, a, b} = i[2:0];
      #10;
      $display(" %b %b  %b  |    %b %b  |      %b   %b", a, b, cin, hc, hs, fc, fs);
      if ({hc, hs} !== a + b) begin
        $display("  错误：半加器 %b + %b = %b%b", a, b, hc, hs);
        errors = errors + 1;
      end
      if ({fc, fs} !== a + b + cin) begin
        $display("  错误：全加器 %b + %b + %b = %b%b", a, b, cin, fc, fs);
        errors = errors + 1;
      end
    end

    if (errors == 0) $display("PASS: 半加器与全加器真值表全部正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
